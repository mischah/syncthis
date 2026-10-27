import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HealthFileData, writeHealthFile } from '../../../cli/src/health';
import { syncViaDaemon } from '../../src/main/daemon-sync';

const health: HealthFileData = {
  startedAt: '2026-01-01T00:00:00.000Z',
  lastSyncAt: '2026-01-01T00:05:00.000Z',
  lastSyncResult: 'no-changes',
  consecutiveFailures: 0,
  lastSuccessAt: '2026-01-01T00:05:00.000Z',
  cycleCount: 1,
};

let tempDir: string;

async function writeLock(data: Record<string, unknown>): Promise<void> {
  await writeFile(join(tempDir, '.syncthis.lock'), JSON.stringify(data));
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-daemon-sync-test-'));
  await writeHealthFile(tempDir, health);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe('syncViaDaemon', () => {
  it('returns false without signalling when there is no lock file', async () => {
    const kill = vi.spyOn(process, 'kill');

    expect(await syncViaDaemon(tempDir, 1000, 10)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('returns false without signalling a daemon that does not advertise a sync signal', async () => {
    await writeLock({ pid: 12345, startedAt: health.startedAt });
    const kill = vi.spyOn(process, 'kill');

    expect(await syncViaDaemon(tempDir, 1000, 10)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('returns false when the daemon process is gone', async () => {
    await writeLock({ pid: 999999, startedAt: health.startedAt, syncSignal: 'SIGUSR2' });

    expect(await syncViaDaemon(tempDir, 1000, 10)).toBe(false);
  });

  it('signals the daemon and waits until it records a new cycle', async () => {
    await writeLock({ pid: 12345, startedAt: health.startedAt, syncSignal: 'SIGUSR2' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      setTimeout(() => {
        void writeHealthFile(tempDir, { ...health, lastSyncAt: '2026-01-01T00:06:00.000Z' });
      }, 20);
      return true;
    });
    const started = Date.now();

    expect(await syncViaDaemon(tempDir, 5000, 10)).toBe(true);
    expect(kill).toHaveBeenCalledWith(12345, 'SIGUSR2');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('gives up waiting after the timeout but still reports the daemon handled it', async () => {
    await writeLock({ pid: 12345, startedAt: health.startedAt, syncSignal: 'SIGUSR2' });
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(await syncViaDaemon(tempDir, 50, 10)).toBe(true);
  });
});
