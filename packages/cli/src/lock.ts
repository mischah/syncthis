import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_FILENAME = '.syncthis.lock';

interface LockData {
  pid: number;
  startedAt: string;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      return true; // process exists, we lack permission to signal it
    }
    return false; // ESRCH – no such process
  }
}

async function readLockFile(dirPath: string): Promise<LockData | null> {
  try {
    const content = await readFile(join(dirPath, LOCK_FILENAME), 'utf8');
    return JSON.parse(content) as LockData;
  } catch {
    return null;
  }
}

async function removeStale(dirPath: string): Promise<void> {
  try {
    await unlink(join(dirPath, LOCK_FILENAME));
  } catch {
    // already gone – ignore
  }
}

export async function isLocked(dirPath: string): Promise<{ locked: boolean; pid?: number }> {
  const lockData = await readLockFile(dirPath);
  if (lockData === null) {
    return { locked: false };
  }
  if (!isProcessRunning(lockData.pid)) {
    await removeStale(dirPath);
    return { locked: false };
  }
  return { locked: true, pid: lockData.pid };
}

export async function acquireLock(dirPath: string): Promise<void> {
  const lockData = await readLockFile(dirPath);
  if (lockData !== null) {
    if (isProcessRunning(lockData.pid)) {
      throw new Error(`Another instance is already running (PID: ${lockData.pid}).`);
    }
    await removeStale(dirPath);
  }
  const newLock: LockData = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  await writeFile(join(dirPath, LOCK_FILENAME), `${JSON.stringify(newLock, null, 2)}\n`, 'utf8');
}

export async function releaseLock(dirPath: string): Promise<void> {
  try {
    await unlink(join(dirPath, LOCK_FILENAME));
  } catch {
    // already gone – ignore
  }
}
