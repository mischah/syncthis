import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsLocked = vi.hoisted(() => vi.fn());
const mockReadLockFile = vi.hoisted(() => vi.fn());
vi.mock('../../src/lock.js', () => ({
  isLocked: mockIsLocked,
  readLockFile: mockReadLockFile,
}));

const mockReadHealthFile = vi.hoisted(() => vi.fn());
vi.mock('../../src/health.js', () => ({
  readHealthFile: mockReadHealthFile,
}));

import type { SyncthisConfig } from '../../src/config.js';
import { determineHealth, getExpectedIntervalMs } from '../../src/health-check.js';

const baseConfig: SyncthisConfig = {
  remote: 'git@github.com:user/repo.git',
  branch: 'main',
  cron: null,
  interval: 300,
  onConflict: 'auto-both',
};

const recentTime = () => new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
const staleTime = () => new Date(Date.now() - 20 * 60_000).toISOString(); // 20 minutes ago

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLockFile.mockResolvedValue({
    pid: process.pid,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
  });
});

describe('getExpectedIntervalMs', () => {
  it('returns interval in ms for interval-based config', () => {
    expect(getExpectedIntervalMs({ ...baseConfig, interval: 60, cron: null })).toBe(60_000);
  });

  it('returns ~5 minutes for default cron */5 * * * *', () => {
    const ms = getExpectedIntervalMs({ ...baseConfig, interval: null, cron: '*/5 * * * *' });
    expect(ms).toBeGreaterThanOrEqual(4 * 60_000);
    expect(ms).toBeLessThanOrEqual(6 * 60_000);
  });

  it('falls back to 5 minutes for invalid cron', () => {
    const ms = getExpectedIntervalMs({ ...baseConfig, interval: null, cron: 'invalid' });
    expect(ms).toBe(5 * 60_000);
  });
});

describe('determineHealth', () => {
  it('returns unhealthy when process is not running', async () => {
    mockIsLocked.mockResolvedValue({ locked: false });
    mockReadHealthFile.mockResolvedValue(null);

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('unhealthy');
    expect(result.reasons).toContain('Process not running');
    expect(result.processRunning).toBe(false);
  });

  it('returns healthy when process is running and sync is recent', async () => {
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    mockReadHealthFile.mockResolvedValue({
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      lastSyncAt: recentTime(),
      lastSyncResult: 'synced',
      consecutiveFailures: 0,
      lastSuccessAt: recentTime(),
      cycleCount: 10,
    });

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('healthy');
    expect(result.reasons).toHaveLength(0);
  });

  it('returns healthy when no health data yet (first cycle pending)', async () => {
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    mockReadHealthFile.mockResolvedValue(null);

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('healthy');
  });

  it('returns degraded when there are consecutive failures below threshold', async () => {
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    mockReadHealthFile.mockResolvedValue({
      startedAt: new Date().toISOString(),
      lastSyncAt: recentTime(),
      lastSyncResult: 'network-error',
      consecutiveFailures: 3,
      lastSuccessAt: recentTime(),
      cycleCount: 10,
    });

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy when consecutiveFailures >= 5', async () => {
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    mockReadHealthFile.mockResolvedValue({
      startedAt: new Date().toISOString(),
      lastSyncAt: recentTime(),
      lastSyncResult: 'network-error',
      consecutiveFailures: 5,
      lastSuccessAt: null,
      cycleCount: 10,
    });

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('unhealthy');
  });

  it('returns degraded when sync is overdue', async () => {
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    // interval = 300s, overdue = 3 * 300s = 900s = 15 min. staleTime is 20 min ago.
    mockReadHealthFile.mockResolvedValue({
      startedAt: new Date().toISOString(),
      lastSyncAt: staleTime(),
      lastSyncResult: 'synced',
      consecutiveFailures: 0,
      lastSuccessAt: staleTime(),
      cycleCount: 5,
    });

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.status).toBe('degraded');
    expect(result.reasons.some((r) => r.includes('overdue'))).toBe(true);
  });

  it('includes uptime when process is running', async () => {
    const startedAt = new Date(Date.now() - 3600_000).toISOString();
    mockIsLocked.mockResolvedValue({ locked: true, pid: process.pid });
    mockReadLockFile.mockResolvedValue({ pid: process.pid, startedAt });
    mockReadHealthFile.mockResolvedValue(null);

    const result = await determineHealth('/some/dir', baseConfig);
    expect(result.uptime).toBeGreaterThan(3500);
    expect(result.uptime).toBeLessThan(3700);
  });
});
