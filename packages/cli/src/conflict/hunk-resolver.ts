import { isCancel, select } from '@clack/prompts';
import { Chalk } from 'chalk';
import { createTwoFilesPatch, structuredPatch } from 'diff';
import { parseUnifiedDiff, renderSingleHunk } from './diff-renderer.js';

const chalk = new Chalk({ level: 3 });

type HunkDecision = 'local' | 'remote' | 'both';

export interface ChunkByChunkResult {
  status: 'resolved' | 'back';
  mergedContent?: string;
}

/**
 * Reconstructs a merged file by applying per-hunk decisions.
 * Uses context:0 diffs so each independent change is a separate hunk.
 */
export function applyHunkDecisions(
  localContent: string,
  remoteContent: string,
  decisions: HunkDecision[],
): string {
  const patch = structuredPatch('f', 'f', localContent, remoteContent, '', '', { context: 0 });
  const { hunks } = patch;

  const localLines = localContent.split('\n');
  const result: string[] = [];
  let pos = 0; // 0-based index into localLines

  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];

    // Copy unchanged lines before this hunk
    result.push(...localLines.slice(pos, h.oldStart - 1));
    pos = h.oldStart - 1;

    // Parse hunk lines into local/remote views
    const oldLines: string[] = [];
    const newLines: string[] = [];
    const addedOnly: string[] = [];

    for (const line of h.lines) {
      if (line.startsWith('\\ ')) continue; // "No newline at end of file"
      const content = line.slice(1);
      if (line.startsWith(' ')) {
        oldLines.push(content);
        newLines.push(content);
      } else if (line.startsWith('-')) {
        oldLines.push(content);
      } else if (line.startsWith('+')) {
        newLines.push(content);
        addedOnly.push(content);
      }
    }

    const decision = decisions[i] ?? 'local';
    if (decision === 'local') {
      result.push(...oldLines);
    } else if (decision === 'remote') {
      result.push(...newLines);
    } else {
      // 'both': keep local lines + append remote additions
      result.push(...oldLines, ...addedOnly);
    }

    pos += h.oldLines;
  }

  // Remaining lines after last hunk
  result.push(...localLines.slice(pos));

  return result.join('\n');
}

/**
 * Interactive UI: shows each diff hunk and asks the user to decide per-hunk.
 * Returns 'back' if the user wants to return to the file-level menu.
 */
export async function resolveChunkByChunk(
  localContent: string,
  remoteContent: string,
  filePath: string,
): Promise<ChunkByChunkResult> {
  // Use context:0 for display so hunk count matches applyHunkDecisions
  const unifiedDiff = createTwoFilesPatch('f', 'f', localContent, remoteContent, '', '', {
    context: 0,
  });
  const hunks = parseUnifiedDiff(unifiedDiff);

  if (hunks.length === 0) {
    return { status: 'resolved', mergedContent: localContent };
  }

  const total = hunks.length;
  const decisions: HunkDecision[] = [];

  for (let i = 0; i < total; i++) {
    const hunkOutput = renderSingleHunk(hunks[i], i, total, {
      localLabel: 'local version',
      remoteLabel: 'remote version',
    });
    console.log(hunkOutput);

    const choice = await select({
      message: `Hunk ${i + 1}/${total} — ${filePath}`,
      options: [
        { value: 'local', label: `${chalk.red('■')} Keep local`, hint: 'discard this change' },
        { value: 'remote', label: `${chalk.green('■')} Keep remote`, hint: 'accept this change' },
        { value: 'both', label: 'Keep both', hint: 'local lines + remote additions' },
        { value: 'back', label: 'Back', hint: 'return to file menu' },
      ],
    });

    if (isCancel(choice) || choice === 'back') {
      return { status: 'back' };
    }

    decisions.push(choice as HunkDecision);
  }

  const mergedContent = applyHunkDecisions(localContent, remoteContent, decisions);
  return { status: 'resolved', mergedContent };
}
