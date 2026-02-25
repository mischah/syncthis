import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncthisConfig } from '../../src/config.js';
import { startScheduler } from '../../src/scheduler.js';

function makeConfig(overrides: Partial<SyncthisConfig>): SyncthisConfig {
  return {
    remote: 'git@github.com:user/vault.git',
    branch: 'main',
    cron: null,
    interval: null,
    ...overrides,
  };
}

describe('startScheduler – interval mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('triggers syncFn after the configured interval', async () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const handle = startScheduler(makeConfig({ interval: 10 }), syncFn);

    expect(syncFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncFn).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it('prevents overlap when syncFn runs longer than the interval', async () => {
    const syncFn = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const handle = startScheduler(makeConfig({ interval: 10 }), syncFn);

    await vi.advanceTimersByTimeAsync(10_000); // first tick → syncFn called, isRunning = true
    await vi.advanceTimersByTimeAsync(10_000); // second tick → skipped because isRunning

    expect(syncFn).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('stop() prevents further syncFn calls', async () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const handle = startScheduler(makeConfig({ interval: 10 }), syncFn);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncFn).toHaveBeenCalledTimes(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

describe('startScheduler – cron mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0)); // 2026-01-01T00:00:00.000
  });
  afterEach(() => vi.useRealTimers());

  it('triggers syncFn when the cron expression fires', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    // '* * * * * *' = every second (croner 6-field format)
    const handle = startScheduler(makeConfig({ cron: '* * * * * *' }), syncFn);

    expect(syncFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500); // advance 1.5 s → fires once at T=1000
    expect(syncFn).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it('stop() prevents further syncFn calls', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const handle = startScheduler(makeConfig({ cron: '* * * * * *' }), syncFn);

    vi.advanceTimersByTime(1_500);
    expect(syncFn).toHaveBeenCalledTimes(1);

    handle.stop();
    vi.advanceTimersByTime(2_000); // would fire twice more if not stopped
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});
