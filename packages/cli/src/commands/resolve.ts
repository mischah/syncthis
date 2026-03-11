import { access } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import simpleGit from 'simple-git';
import { loadConfig } from '../config.js';
import { resolveInteractive } from '../conflict/interactive.js';
import { getConflictFiles, isRebaseInProgress } from '../conflict/resolver.js';
import type { Logger } from '../logger.js';

export interface ResolveOptions {
  path: string;
}

export async function handleResolve(options: ResolveOptions): Promise<void> {
  const dirPath = options.path;

  // Verify this is a syncthis directory
  const configPath = join(dirPath, '.syncthis.json');
  try {
    await access(configPath);
  } catch {
    console.error("Error: Not a syncthis directory. Run 'syncthis init' first.");
    process.exit(1);
  }

  const config = await loadConfig(dirPath);
  const git = simpleGit(dirPath);

  const logger: Logger = {
    debug: () => {},
    info: (msg: string) => console.log(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };

  const rebaseInProgress = await isRebaseInProgress(git);
  if (!rebaseInProgress) {
    console.log('No rebase in progress. Nothing to resolve.');
    process.exit(0);
  }

  let totalResolved = 0;
  let steps = 0;
  const maxSteps = 20;
  let isFirstCheck = true;

  while (true) {
    const files = await getConflictFiles(git);

    if (files.length === 0) {
      if (isFirstCheck) {
        console.log(
          "Rebase in progress but no conflicts found. Run 'git rebase --continue' to finish.",
        );
        process.exit(0);
      }
      break;
    }

    isFirstCheck = false;
    steps++;
    if (steps > maxSteps) {
      logger.error(
        `Too many consecutive conflicts during rebase (${maxSteps}+). Interactive resolution aborted. Run 'git rebase --abort' to reset.`,
      );
      await git.raw(['rebase', '--abort']);
      process.exit(1);
    }

    const result = await resolveInteractive({ git, files, logger, dirPath });

    if (result.status !== 'resolved') {
      process.exit(1);
    }

    totalResolved += result.resolvedFiles.length;

    try {
      await git.raw(['-c', 'core.editor=true', 'rebase', '--continue']);
    } catch {
      // Next commit may also have conflicts — detected by getConflictFiles on next iteration
    }
  }

  try {
    await git.push('origin', config.branch);
    console.log(
      `${chalk.green('✓')} All conflicts resolved. ${totalResolved} files resolved, pushed to origin.`,
    );
  } catch (err) {
    console.warn(
      `Warning: Conflicts resolved but push failed: ${String(err)}. Will retry on next sync cycle.`,
    );
  }
}
