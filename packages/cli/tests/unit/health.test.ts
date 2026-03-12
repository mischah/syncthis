import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type HealthFileData,
  readHealthFile,
  updateHealthAfterCycle,
  writeHealthFile,
} from '../../src/health.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-health-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('readHealthFile / writeHealthFile', () => {
  it('returns null when file does not exist', async () => {
    expect(await readHealthFile(tempDir)).toBeNull();
  });

  it('round-trips data correctly', async () => {
    const data: HealthFileData = {
      startedAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: '2026-01-01T00:05:00.000Z',
      lastSyncResult: 'synced',
      consecutiveFailures: 0,
      lastSuccessAt: '2026-01-01T00:05:00.000Z',
      cycleCount: 3,
    };
    await writeHealthFile(tempDir, data);
    expect(await readHealthFile(tempDir)).toEqual(data);
  });

  it('creates .syncthis directory if missing', async () => {
    const data: HealthFileData = {
      startedAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: null,
      lastSyncResult: null,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      cycleCount: 0,
    };
    await expect(writeHealthFile(tempDir, data)).resolves.toBeUndefined();
  });
});

describe('updateHealthAfterCycle', () => {
  const startedAt = '2026-01-01T00:00:00.000Z';

  it('creates health file from scratch on first cycle', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'synced', filesChanged: 2 }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data).not.toBeNull();
    expect(data?.lastSyncResult).toBe('synced');
    expect(data?.consecutiveFailures).toBe(0);
    expect(data?.cycleCount).toBe(1);
    expect(data?.startedAt).toBe(startedAt);
  });

  it('increments consecutiveFailures on network-error', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data?.consecutiveFailures).toBe(2);
    expect(data?.cycleCount).toBe(2);
  });

  it('increments consecutiveFailures on conflict', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'conflict' }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data?.consecutiveFailures).toBe(1);
  });

  it('resets consecutiveFailures on successful sync', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'synced' }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data?.consecutiveFailures).toBe(0);
    expect(data?.lastSuccessAt).not.toBeNull();
  });

  it('resets consecutiveFailures on no-changes', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'no-changes' }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data?.consecutiveFailures).toBe(0);
  });

  it('resets consecutiveFailures on pulled', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'pulled' }, startedAt);
    const data = await readHealthFile(tempDir);
    expect(data?.consecutiveFailures).toBe(0);
  });

  it('updates lastSuccessAt only on success', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'synced' }, startedAt);
    const afterSuccess = await readHealthFile(tempDir);
    const successTime = afterSuccess?.lastSuccessAt;

    await updateHealthAfterCycle(tempDir, { status: 'network-error' }, startedAt);
    const afterFailure = await readHealthFile(tempDir);
    expect(afterFailure?.lastSuccessAt).toBe(successTime);
  });

  it('preserves startedAt from existing file', async () => {
    await updateHealthAfterCycle(tempDir, { status: 'synced' }, startedAt);
    await updateHealthAfterCycle(tempDir, { status: 'synced' }, 'different-start');
    const data = await readHealthFile(tempDir);
    expect(data?.startedAt).toBe(startedAt);
  });
});
