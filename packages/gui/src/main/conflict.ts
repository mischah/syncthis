import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ConflictFile,
  DiffChange,
  DiffHunk,
  DiffLine,
  FileDiff,
  ImageData,
} from '@syncthis/shared';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

async function getGitStageBuffer(dirPath: string, stage: 2 | 3, filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    getGitBinaryPath(),
    ['-C', dirPath, 'show', `:${stage}:${filePath}`],
    {
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...getGitEnv() },
    },
  );
  return stdout;
}
import { diffWords, structuredPatch } from 'diff';
import { generateConflictFilename } from '../../../cli/src/conflict/conflict-filename.js';
import { applyHunkDecisions } from '../../../cli/src/conflict/hunk-resolver.js';
import { readHealthFile, writeHealthFile } from '../../../cli/src/health.js';
import { createLogger } from '../../../cli/src/logger.js';
import { getGitBinaryPath, getGitEnv, getSimpleGit } from './git-provider.js';

export async function isRebaseInProgress(dirPath: string): Promise<boolean> {
  const git = getSimpleGit(dirPath);
  const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  const rebaseApply = path.join(gitDir, 'rebase-apply');

  const exists = async (p: string): Promise<boolean> => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  };

  return (await exists(rebaseMerge)) || (await exists(rebaseApply));
}

export async function getConflictingFiles(dirPath: string): Promise<ConflictFile[]> {
  const git = getSimpleGit(dirPath);
  const output = await git.raw(['diff', '-z', '--name-only', '--diff-filter=U']);
  return output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => ({ filePath, status: 'pending' as const }));
}

export async function getFileDiff(dirPath: string, filePath: string): Promise<FileDiff> {
  const git = getSimpleGit(dirPath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_EXTENSIONS[ext];

  const localContent = await git.raw(['show', `:2:${filePath}`]);

  // Detect binary files by checking for null bytes in the raw content
  if (localContent.includes('\0')) {
    // Binary image: try to build a side-by-side preview
    if (mimeType && mimeType !== 'image/svg+xml') {
      try {
        const localBuf = await getGitStageBuffer(dirPath, 2, filePath);
        const remoteBuf = await getGitStageBuffer(dirPath, 3, filePath);
        if (localBuf.length <= IMAGE_SIZE_LIMIT && remoteBuf.length <= IMAGE_SIZE_LIMIT) {
          const imageData: ImageData = {
            mimeType,
            localDataUrl: `data:${mimeType};base64,${localBuf.toString('base64')}`,
            remoteDataUrl: `data:${mimeType};base64,${remoteBuf.toString('base64')}`,
            localSize: localBuf.length,
            remoteSize: remoteBuf.length,
          };
          return { filePath, hunks: [], sourceLines: [], isBinary: true, imageData };
        }
      } catch {
        // Fall through to plain binary placeholder
      }
    }
    return { filePath, hunks: [], sourceLines: [], isBinary: true };
  }

  const remoteContent = await git.raw(['show', `:3:${filePath}`]);
  if (remoteContent.includes('\0')) {
    return { filePath, hunks: [], sourceLines: [], isBinary: true };
  }

  // context: 0 keeps hunks separate (matching CLI hunk count for resolveHunk)
  const patch = structuredPatch('f', 'f', localContent, remoteContent, '', '', { context: 0 });
  const sourceLines = localContent.split('\n');

  const hunks: DiffHunk[] = patch.hunks.map((h, index) => {
    const localLines: string[] = [];
    const remoteLines: string[] = [];
    const lines: DiffLine[] = [];

    for (const line of h.lines) {
      if (line.startsWith('\\ ')) continue;
      const text = line.slice(1);
      if (line.startsWith(' ')) {
        localLines.push(text);
        remoteLines.push(text);
        lines.push({ type: 'context', text });
      } else if (line.startsWith('-')) {
        localLines.push(text);
        lines.push({ type: 'local', text });
      } else if (line.startsWith('+')) {
        remoteLines.push(text);
        lines.push({ type: 'remote', text });
      }
    }

    // Word-level diff across the whole hunk text (kept for backward compat)
    const rawChanges = diffWords(localLines.join('\n'), remoteLines.join('\n'));
    const changes: DiffChange[] = rawChanges.map((c) => ({
      type: c.added ? 'added' : c.removed ? 'removed' : 'unchanged',
      value: c.value,
    }));

    return { index, startLine: h.oldStart, localLines, remoteLines, changes, lines };
  });

  // SVG: attach image preview data alongside the text diff
  if (mimeType === 'image/svg+xml') {
    const imageData: ImageData = {
      mimeType: 'image/svg+xml',
      localDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(localContent)}`,
      remoteDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(remoteContent)}`,
      localSize: Buffer.byteLength(localContent, 'utf8'),
      remoteSize: Buffer.byteLength(remoteContent, 'utf8'),
    };
    return { filePath, hunks, sourceLines, imageData };
  }

  return { filePath, hunks, sourceLines };
}

export async function resolveFile(
  dirPath: string,
  filePath: string,
  choice: 'local' | 'remote' | 'both',
): Promise<void> {
  const git = getSimpleGit(dirPath);

  if (choice === 'local') {
    await git.raw(['checkout', '--ours', filePath]);
    await git.add([filePath]);
    return;
  }

  if (choice === 'remote') {
    await git.raw(['checkout', '--theirs', filePath]);
    await git.add([filePath]);
    return;
  }

  // 'both': keep local (ours), save remote as conflict copy
  const remoteContent = await git.raw(['show', `:3:${filePath}`]);
  const timestamp = new Date();
  const conflictCopyPath = generateConflictFilename(filePath, timestamp, (p) =>
    existsSync(path.join(dirPath, p)),
  );
  await writeFile(path.join(dirPath, conflictCopyPath), remoteContent, 'utf8');
  await git.raw(['checkout', '--ours', filePath]);
  await git.add([filePath, conflictCopyPath]);
}

export async function resolveHunks(
  dirPath: string,
  filePath: string,
  decisions: Array<'local' | 'remote'>,
): Promise<void> {
  const git = getSimpleGit(dirPath);
  const localContent = await git.raw(['show', `:2:${filePath}`]);
  const remoteContent = await git.raw(['show', `:3:${filePath}`]);

  const merged = applyHunkDecisions(localContent, remoteContent, decisions);
  await writeFile(path.join(dirPath, filePath), merged, 'utf8');
  await git.add([filePath]);
}

export async function abortRebase(dirPath: string): Promise<void> {
  const git = getSimpleGit(dirPath);
  await git.raw(['rebase', '--abort']);
}

export async function finalizeRebase(dirPath: string): Promise<void> {
  const git = getSimpleGit(dirPath);
  const logDir = path.join(dirPath, '.syncthis', 'logs');
  const logger = createLogger({ level: 'info', logDir });

  try {
    await git.raw(['-c', 'core.editor=true', 'rebase', '--continue']);
  } catch (err) {
    // Rebase may still be in progress if there were errors
    if (await isRebaseInProgress(dirPath)) {
      throw new Error(`Failed to finalize rebase: ${String(err)}`);
    }
    // Otherwise rebase completed despite the throw (simple-git noise)
  }

  // Reset health before push: rebase completed, so health is restored even if push fails
  const existing = await readHealthFile(dirPath);
  if (existing) {
    const now = new Date().toISOString();
    await writeHealthFile(dirPath, {
      ...existing,
      lastSyncAt: now,
      lastSyncResult: 'synced',
      consecutiveFailures: 0,
      lastSuccessAt: now,
    });
  }

  try {
    await git.push();
    logger.info('Conflicts resolved, pushed to origin.');
  } catch (err) {
    logger.warn(
      `Conflicts resolved but push failed: ${String(err)}. Sync will retry on the next cycle.`,
    );
    throw new Error(
      `Conflicts resolved but push failed: ${String(err)}. Sync will retry on the next cycle.`,
    );
  }
}
