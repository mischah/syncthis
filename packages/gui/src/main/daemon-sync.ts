import { setTimeout as sleep } from 'node:timers/promises';
import { readHealthFile } from '../../../cli/src/health.js';
import { readLockFile } from '../../../cli/src/lock.js';

/**
 * Asks the running daemon to sync now and waits until its health file reports
 * a new cycle, so manual syncs never overlap with the daemon's own cycles.
 * Returns false if no daemon is running or it doesn't advertise a sync signal;
 * the caller should then sync directly.
 */
export async function syncViaDaemon(
  dirPath: string,
  timeoutMs: number,
  pollMs = 500,
): Promise<boolean> {
  const lockData = await readLockFile(dirPath);
  if (lockData?.syncSignal === undefined) return false;

  const previousLastSyncAt = (await readHealthFile(dirPath))?.lastSyncAt ?? null;
  try {
    process.kill(lockData.pid, lockData.syncSignal);
  } catch {
    return false; // stale lock – daemon is gone
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await readHealthFile(dirPath);
    if (data !== null && data.lastSyncAt !== previousLastSyncAt) break;
    await sleep(pollMs);
  }
  return true;
}
