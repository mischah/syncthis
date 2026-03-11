import path from 'node:path';
import { intro, isCancel, log, outro, select } from '@clack/prompts';
import { Chalk } from 'chalk';
import type { SimpleGit } from 'simple-git';
import type { Logger } from '../logger.js';
import { renderConflictDiff } from './diff-renderer.js';
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
    choice: 'local' | 'remote' | 'both';
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
  const decisions: Array<{ filePath: string; choice: 'local' | 'remote' | 'both' }> = [];
  const total = files.length;

  intro('syncthis – Conflict Resolution');

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const { filePath } = file;

    log.step(`[${i + 1}/${total}] ${filePath}`);

    const localContent = await git.raw(['show', `:2:${filePath}`]);
    const remoteContent = await git.raw(['show', `:3:${filePath}`]);

    const diffOutput = renderConflictDiff(filePath, localContent, remoteContent, {
      localLabel: 'local version',
      remoteLabel: 'remote version',
    });
    console.log(diffOutput);

    const choice = await select({
      message: `How do you want to resolve ${path.basename(filePath)}?`,
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
        { value: 'both', label: 'Keep both versions', hint: 'remote saved as .conflict copy' },
        { value: 'abort', label: 'Abort rebase', hint: 'cancel and undo all changes' },
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

    const userChoice = choice as 'local' | 'remote' | 'both';
    const timestamp = new Date();
    const result = await resolveFile(git, file, 'auto-both', timestamp, dirPath, userChoice);

    resolvedFiles.push(filePath);
    if (result.conflictCopy) {
      conflictCopies.push(result.conflictCopy);
    }
    decisions.push({ filePath, choice: userChoice });
    logger.info(`Resolved: ${filePath} → ${userChoice}`);
  }

  outro(`✓ All conflicts resolved. ${resolvedFiles.length} files resolved.`);

  return { status: 'resolved', resolvedFiles, conflictCopies, decisions };
}
