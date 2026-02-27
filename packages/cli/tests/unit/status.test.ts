import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the module under test
const mockLoadConfig = vi.hoisted(() => vi.fn());
vi.mock('../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

const mockIsLocked = vi.hoisted(() => vi.fn());
const mockReadLockFile = vi.hoisted(() => vi.fn());
vi.mock('../../src/lock.js', () => ({
  isLocked: mockIsLocked,
  readLockFile: mockReadLockFile,
}));

const mockAccess = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  access: mockAccess,
}));

const mockGitInstance = vi.hoisted(() => ({
  revparse: vi.fn(),
  getRemotes: vi.fn(),
  raw: vi.fn(),
  log: vi.fn(),
}));
vi.mock('simple-git', () => ({
  default: () => mockGitInstance,
}));

import { handleStatus } from '../../src/commands/status.js';

describe('handleStatus', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints "Not initialized" when .syncthis.json does not exist', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Not initialized'));
  });

  it('shows config details with cron schedule', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([
      { name: 'origin', refs: { fetch: 'git@github.com:user/vault.git' } },
    ]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('Config: valid');
    expect(logSpy).toHaveBeenCalledWith('  Remote:   git@github.com:user/vault.git');
    expect(logSpy).toHaveBeenCalledWith('  Branch:   main');
    expect(logSpy).toHaveBeenCalledWith('  Schedule: */5 * * * *');
  });

  it('shows config details with interval schedule', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: null,
      interval: 60,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('  Schedule: 60s');
  });

  it('shows error when config is invalid', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockRejectedValueOnce(new Error('missing remote'));
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('Config: invalid – missing remote');
  });

  it('shows "running" with PID when lock file exists', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: true, pid: 12345 });
    mockReadLockFile.mockResolvedValueOnce({ schedule: 'every 60s' });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running (PID: 12345)'));
    expect(logSpy).toHaveBeenCalledWith('  Schedule: every 60s');
  });

  it('shows schedule from config when lock file has no schedule', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: null,
      interval: 30,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: true, pid: 999 });
    mockReadLockFile.mockResolvedValueOnce({});
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('  Schedule: every 30s');
  });

  it('shows "not running" when no lock file', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('shows git info including remote, uncommitted changes, and last commit', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([
      { name: 'origin', refs: { fetch: 'git@github.com:user/vault.git' } },
    ]);
    mockGitInstance.raw.mockResolvedValueOnce(' M file1.txt\n?? file2.txt\n');
    mockGitInstance.log.mockResolvedValueOnce({
      latest: { date: '2025-01-01', message: 'chore: sync' },
    });

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('  Remote:              git@github.com:user/vault.git');
    expect(logSpy).toHaveBeenCalledWith('  Uncommitted changes: 2');
    expect(logSpy).toHaveBeenCalledWith('  Last commit:         2025-01-01 – chore: sync');
  });

  it('shows git error message when not a git repo', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockRejectedValueOnce(new Error('not a git repo'));

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('  Not a git repository or git error.');
  });
});
