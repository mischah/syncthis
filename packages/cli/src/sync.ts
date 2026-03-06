import simpleGit from 'simple-git';
import type { SyncthisConfig } from './config.js';
import { notifyConflict } from './conflict/notify.js';
import { resolveRebase } from './conflict/resolver.js';
import type { Logger } from './logger.js';

export interface SyncResult {
  status: 'no-changes' | 'pulled' | 'synced' | 'conflict' | 'network-error';
  filesChanged?: number;
  conflictCopies?: string[];
  error?: string;
}

const CONFLICT_PREFIXES = ['UU ', 'AA ', 'DD ', 'AU ', 'UA ', 'DU ', 'UD '];

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function hasConflictMarkers(porcelainOutput: string): boolean {
  return porcelainOutput
    .split('\n')
    .filter(Boolean)
    .some((line) => CONFLICT_PREFIXES.some((prefix) => line.startsWith(prefix)));
}

export async function runSyncCycle(
  dirPath: string,
  config: SyncthisConfig,
  logger: Logger,
): Promise<SyncResult> {
  const git = simpleGit(dirPath);

  // Step 1: Check for local changes
  const statusOutput = await git.raw(['status', '--porcelain']);
  const changedLines = statusOutput.split('\n').filter(Boolean);
  const filesChanged = changedLines.length;

  // Step 2: Commit local changes (if any)
  if (filesChanged > 0) {
    const timestamp = toLocalISOString(new Date());
    const commitMessage = `sync: auto-commit ${timestamp} (${filesChanged} files changed)`;
    await git.add(['-A']);
    await git.commit(commitMessage);
  }

  // Step 3: Always pull with rebase to get remote changes from other devices
  const headBefore = await git.raw(['rev-parse', 'HEAD']);
  try {
    await git.pull('origin', config.branch, ['--rebase']);
  } catch (err) {
    const postPullStatus = await git.raw(['status', '--porcelain']);
    if (hasConflictMarkers(postPullStatus)) {
      const conflictedFiles = postPullStatus
        .split('\n')
        .filter(Boolean)
        .filter((line) => CONFLICT_PREFIXES.some((prefix) => line.startsWith(prefix)))
        .map((line) => line.slice(3));

      if (config.onConflict === 'auto-both' || config.onConflict === 'auto-newest') {
        const resolveResult = await resolveRebase(git, config.onConflict, dirPath, logger);
        if (resolveResult.status === 'resolved') {
          notifyConflict(
            {
              type: 'conflict-resolved',
              strategy: config.onConflict,
              files: resolveResult.resolvedFiles,
              dirPath,
              message: `Conflicts auto-resolved (${config.onConflict}): ${resolveResult.resolvedFiles.join(', ')}`,
            },
            logger,
          );
          try {
            await git.push('origin', config.branch);
            logger.info(`Sync cycle: ${filesChanged} files changed, committed, pushed.`);
            return { status: 'synced', filesChanged, conflictCopies: resolveResult.conflictCopies };
          } catch (pushErr) {
            logger.warn(`Push failed: ${String(pushErr)}. Will retry next cycle.`);
            return { status: 'network-error', error: String(pushErr), filesChanged };
          }
        }
        notifyConflict(
          {
            type: 'conflict-limit-reached',
            strategy: config.onConflict,
            files: conflictedFiles,
            dirPath,
            message:
              'Too many consecutive conflicts during rebase. Auto-resolution aborted. Resolve manually.',
          },
          logger,
        );
        return { status: 'conflict', error: 'Rebase limit reached', filesChanged };
      }

      notifyConflict(
        {
          type: 'conflict-unresolved',
          strategy: 'stop',
          files: conflictedFiles,
          dirPath,
          message: `Rebase conflict detected in: ${conflictedFiles.join(', ')}. Sync paused. Resolve conflicts manually, then run 'git rebase --continue' and restart syncthis.`,
        },
        logger,
      );
      return { status: 'conflict', error: String(err), filesChanged };
    }
    logger.warn('Pull failed: Network unreachable. Will retry next cycle.');
    return { status: 'network-error', error: String(err), filesChanged };
  }

  // Step 4: Push only if we committed local changes
  if (filesChanged > 0) {
    try {
      await git.push('origin', config.branch);
      logger.info(`Sync cycle: ${filesChanged} files changed, committed, pushed.`);
      return { status: 'synced', filesChanged };
    } catch (err) {
      logger.warn(`Push failed: ${String(err)}. Will retry next cycle.`);
      return { status: 'network-error', error: String(err), filesChanged };
    }
  }

  // No local changes — check if pull brought in remote changes
  const headAfter = await git.raw(['rev-parse', 'HEAD']);
  if (headBefore.trim() !== headAfter.trim()) {
    logger.info('Sync cycle: pulled remote changes.');
    return { status: 'pulled' };
  }

  logger.debug('Sync cycle: no changes detected.');
  return { status: 'no-changes' };
}
