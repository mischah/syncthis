import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncthisConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { runSyncCycle } from '../../src/sync.js';

const mockGit = vi.hoisted(() => ({
  raw: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}));

const config: SyncthisConfig = {
  remote: 'git@github.com:user/vault.git',
  branch: 'main',
  cron: '*/5 * * * *',
  interval: null,
};

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGit.add.mockResolvedValue(undefined);
  mockGit.commit.mockResolvedValue(undefined);
  mockGit.pull.mockResolvedValue(undefined);
  mockGit.push.mockResolvedValue(undefined);
});

describe('runSyncCycle', () => {
  it('returns { status: "no-changes" } and skips git operations when there are no changes', async () => {
    mockGit.raw.mockResolvedValue('');

    const result = await runSyncCycle('/repo', config, logger);

    expect(result).toEqual({ status: 'no-changes' });
    expect(mockGit.add).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.pull).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('calls add, commit, pull, push in correct order and returns { status: "synced" }', async () => {
    mockGit.raw.mockResolvedValue('M file1.md\nA file2.md\n');

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('synced');
    expect(result.filesChanged).toBe(2);
    expect(mockGit.add).toHaveBeenCalledWith(['-A']);
    expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', ['--rebase']);
    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');

    const [addOrder] = mockGit.add.mock.invocationCallOrder;
    const [commitOrder] = mockGit.commit.mock.invocationCallOrder;
    const [pullOrder] = mockGit.pull.mock.invocationCallOrder;
    const [pushOrder] = mockGit.push.mock.invocationCallOrder;
    expect(addOrder).toBeLessThan(commitOrder);
    expect(commitOrder).toBeLessThan(pullOrder);
    expect(pullOrder).toBeLessThan(pushOrder);
  });

  it('commit message contains local ISO timestamp and file count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 23, 14, 30, 0));

    mockGit.raw.mockResolvedValue('M file1.md\nA file2.md\nD file3.md\n');

    await runSyncCycle('/repo', config, logger);

    expect(mockGit.commit).toHaveBeenCalledWith(
      'sync: auto-commit 2026-02-23T14:30:00 (3 files changed)',
    );

    vi.useRealTimers();
  });

  it('returns { status: "conflict" } and logs error when rebase detects conflicts', async () => {
    mockGit.raw.mockResolvedValueOnce('M file1.md\n').mockResolvedValueOnce('UU file1.md\n');
    mockGit.pull.mockRejectedValue(new Error('CONFLICTS'));

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('conflict');
    expect(result.filesChanged).toBe(1);
    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns { status: "network-error" } and logs warn when push fails', async () => {
    mockGit.raw.mockResolvedValue('M file1.md\n');
    mockGit.push.mockRejectedValue(new Error('network error'));

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('network-error');
    expect(result.filesChanged).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs info on successful sync', async () => {
    mockGit.raw.mockResolvedValue('M file1.md\n');

    await runSyncCycle('/repo', config, logger);

    expect(logger.info).toHaveBeenCalledWith('Sync cycle: 1 files changed, committed, pushed.');
  });
});
