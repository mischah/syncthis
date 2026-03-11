import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intro, isCancel, log, outro, select } from '@clack/prompts';
import { Chalk } from 'chalk';
import type { SimpleGit } from 'simple-git';
import type { Logger } from '../logger.js';
import { renderConflictDiff, renderStatusLine } from './diff-renderer.js';
import { getHunkCount, resolveChunkByChunk } from './hunk-resolver.js';
import { type ConflictFile, resolveFile } from './resolver.js';

const chalk = new Chalk({ level: 3 });

export interface InteractiveResolveOptions {
  git: SimpleGit;
  files: ConflictFile[];
  logger: Logger;
  dirPath: string;
}

export interface InteractiveResolveResult {
  status: 'resolved' | 'cancelled' | 'aborted';
  resolvedFiles: string[];
  conflictCopies: string[];
  decisions: Array<{
    filePath: string;
    choice: 'local' | 'remote' | 'both' | 'chunk-by-chunk';
  }>;
}

export async function resolveInteractive(
  options: InteractiveResolveOptions,
): Promise<InteractiveResolveResult> {
  const { git, files, logger, dirPath } = options;

  if (files.length === 0) {
    return { status: 'resolved', resolvedFiles: [], conflictCopies: [], decisions: [] };
  }

  const resolvedFiles: string[] = [];
  const conflictCopies: string[] = [];
  const decisions: Array<{
    filePath: string;
    choice: 'local' | 'remote' | 'both' | 'chunk-by-chunk';
  }> = [];
  const total = files.length;

  intro('syncthis – Conflict Resolution');

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const { filePath } = file;
    const fileName = path.basename(filePath);

    const localContent = await git.raw(['show', `:2:${filePath}`]);
    const remoteContent = await git.raw(['show', `:3:${filePath}`]);

    const hunkCount = getHunkCount(localContent, remoteContent);
    const diffOutput = renderConflictDiff(filePath, localContent, remoteContent, {
      localLabel: 'local version',
      remoteLabel: 'remote version',
    });

    const renderFileView = () => {
      const statusLine = renderStatusLine({
        file: { index: i, total, resolved: resolvedFiles.length },
        fileName,
      });
      console.clear();
      log.step(statusLine);
      console.log(diffOutput);
      log.step(statusLine);
    };

    renderFileView();

    let fileResolved = false;
    while (!fileResolved) {
      const choice = await select({
        message: `How do you want to resolve ${fileName}?`,
        options: [
          {
            value: 'local',
            label: `${chalk.red('■')} Keep local version`,
            hint: 'discard remote changes',
          },
          {
            value: 'remote',
            label: `${chalk.green('■')} Keep remote version`,
            hint: 'discard local changes',
          },
          { value: 'both', label: '  Keep both versions', hint: 'remote saved as .conflict copy' },
          ...(hunkCount > 1
            ? [
                {
                  value: 'chunk-by-chunk',
                  label: '  Resolve chunk-by-chunk',
                  hint: 'decide per diff hunk',
                },
              ]
            : []),
          { value: 'abort', label: '  Abort rebase', hint: 'cancel and undo all changes' },
        ],
      });

      if (isCancel(choice)) {
        await git.raw(['rebase', '--abort']);
        return { status: 'cancelled', resolvedFiles, conflictCopies, decisions };
      }

      if (choice === 'abort') {
        await git.raw(['rebase', '--abort']);
        return { status: 'aborted', resolvedFiles, conflictCopies, decisions };
      }

      if (choice === 'chunk-by-chunk') {
        const chunkResult = await resolveChunkByChunk(localContent, remoteContent, filePath, {
          index: i,
          total,
          resolved: resolvedFiles.length,
        });
        if (chunkResult.status === 'back') {
          renderFileView();
          continue;
        }
        const fullPath = path.join(dirPath, filePath);
        await writeFile(fullPath, chunkResult.mergedContent ?? '', 'utf8');
        await git.add([filePath]);
        resolvedFiles.push(filePath);
        decisions.push({ filePath, choice: 'chunk-by-chunk' });
        logger.info(`Resolved: ${filePath} → chunk-by-chunk`);
        fileResolved = true;
        continue;
      }

      const userChoice = choice as 'local' | 'remote' | 'both';
      const timestamp = new Date();
      const result = await resolveFile(git, file, 'auto-both', timestamp, dirPath, userChoice);

      resolvedFiles.push(filePath);
      if (result.conflictCopy) {
        conflictCopies.push(result.conflictCopy);
      }
      decisions.push({ filePath, choice: userChoice });
      logger.info(`Resolved: ${filePath} → ${userChoice}`);
      fileResolved = true;
    }
  }

  console.clear();
  outro(`✓ All conflicts resolved. ${resolvedFiles.length} files resolved.`);

  return { status: 'resolved', resolvedFiles, conflictCopies, decisions };
}
