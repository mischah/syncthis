import simpleGit from 'simple-git';
import type { SyncthisConfig } from './config.js';
import type { Logger } from './logger.js';

export interface SyncResult {
  status: 'no-changes' | 'synced' | 'conflict' | 'network-error';
  filesChanged?: number;
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

  // Step 1: Check for changes
  const statusOutput = await git.raw(['status', '--porcelain']);
  const changedLines = statusOutput.split('\n').filter(Boolean);
  const filesChanged = changedLines.length;

  if (filesChanged === 0) {
    logger.debug('Sync cycle: no changes detected.');
    return { status: 'no-changes' };
  }

  // Step 2: Add and commit
  const timestamp = toLocalISOString(new Date());
  const commitMessage = `sync: auto-commit ${timestamp} (${filesChanged} files changed)`;
  await git.add(['-A']);
  await git.commit(commitMessage);

  // Step 3: Pull with rebase
  try {
    await git.pull('origin', config.branch, ['--rebase']);
  } catch (err) {
    const postPullStatus = await git.raw(['status', '--porcelain']);
    if (hasConflictMarkers(postPullStatus)) {
      const conflictedFiles = postPullStatus
        .split('\n')
        .filter(Boolean)
        .filter((line) => CONFLICT_PREFIXES.some((prefix) => line.startsWith(prefix)))
        .map((line) => line.slice(3))
        .join(', ');
      logger.error(`Rebase conflict detected in: ${conflictedFiles}. Sync paused.`);
      logger.error(
        `Resolve conflicts manually, then run 'git rebase --continue' and restart syncthis.`,
      );
      return { status: 'conflict', error: String(err), filesChanged };
    }
    logger.warn('Pull failed: Network unreachable. Will retry next cycle.');
    return { status: 'network-error', error: String(err), filesChanged };
  }

  // Step 4: Push
  try {
    await git.push('origin', config.branch);
    logger.info(`Sync cycle: ${filesChanged} files changed, committed, pushed.`);
    return { status: 'synced', filesChanged };
  } catch (err) {
    logger.warn(`Push failed: ${String(err)}. Will retry next cycle.`);
    return { status: 'network-error', error: String(err), filesChanged };
  }
}
