import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, isLocked, releaseLock } from '../../src/lock.js';

const LOCK_FILE = '.syncthis.lock';
const STALE_PID = 999999;

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-lock-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('creates lock file with correct PID', async () => {
    await acquireLock(tempDir);

    const content = await readFile(join(tempDir, LOCK_FILE), 'utf8');
    const data = JSON.parse(content);
    expect(data.pid).toBe(process.pid);
    expect(new Date(data.startedAt).toISOString()).toBe(data.startedAt);
  });

  it('throws with PID in message when lock is already held', async () => {
    await acquireLock(tempDir);

    await expect(acquireLock(tempDir)).rejects.toThrow(
      `Another instance is already running (PID: ${process.pid}).`,
    );
  });

  it('clears stale lock and acquires new lock', async () => {
    const stale = { pid: STALE_PID, startedAt: new Date().toISOString() };
    await writeFile(join(tempDir, LOCK_FILE), `${JSON.stringify(stale, null, 2)}\n`, 'utf8');

    await expect(acquireLock(tempDir)).resolves.toBeUndefined();

    const content = await readFile(join(tempDir, LOCK_FILE), 'utf8');
    expect(JSON.parse(content).pid).toBe(process.pid);
  });
});

describe('releaseLock', () => {
  it('deletes the lock file', async () => {
    await acquireLock(tempDir);
    await releaseLock(tempDir);

    await expect(readFile(join(tempDir, LOCK_FILE), 'utf8')).rejects.toThrow();
  });

  it('does not throw when no lock file exists', async () => {
    await expect(releaseLock(tempDir)).resolves.toBeUndefined();
  });
});

describe('isLocked', () => {
  it('returns { locked: false } when no lock file exists', async () => {
    expect(await isLocked(tempDir)).toEqual({ locked: false });
  });

  it('returns { locked: true, pid } when lock is held by current process', async () => {
    await acquireLock(tempDir);

    const result = await isLocked(tempDir);
    expect(result.locked).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it('returns { locked: false } and removes stale lock file', async () => {
    const stale = { pid: STALE_PID, startedAt: new Date().toISOString() };
    await writeFile(join(tempDir, LOCK_FILE), `${JSON.stringify(stale, null, 2)}\n`, 'utf8');

    expect(await isLocked(tempDir)).toEqual({ locked: false });

    await expect(readFile(join(tempDir, LOCK_FILE), 'utf8')).rejects.toThrow();
  });
});
