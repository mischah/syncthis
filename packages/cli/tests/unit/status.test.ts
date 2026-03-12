import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the module under test
const mockPrintDaemonTable = vi.hoisted(() => vi.fn());
vi.mock('../../src/commands/daemon.js', () => ({
  printDaemonTable: mockPrintDaemonTable,
}));

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

const mockGetPlatform = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/platform.js', () => ({
  getPlatform: mockGetPlatform,
}));

const mockGenerateServiceName = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/service-name.js', () => ({
  generateServiceName: mockGenerateServiceName,
}));

const mockIsRebaseInProgress = vi.hoisted(() => vi.fn());
vi.mock('../../src/conflict/resolver.js', () => ({
  isRebaseInProgress: mockIsRebaseInProgress,
}));

const mockReadHealthFile = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('../../src/health.js', () => ({
  readHealthFile: mockReadHealthFile,
}));

import { handleStatus } from '../../src/commands/status.js';

describe('handleStatus', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Default: platform throws (unsupported), so service section is skipped
    mockGetPlatform.mockImplementation(() => {
      throw new Error('Unsupported platform');
    });
    mockIsRebaseInProgress.mockResolvedValue(false);
  });

  it('prints "Not initialized" when .syncthis.json does not exist and --path was explicit', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await handleStatus({ path: '/tmp/test', pathExplicit: true });

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

    expect(logSpy).toHaveBeenCalledWith('Config:');
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

  it('shows service status when platform is supported and service is running', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockLoadConfig.mockResolvedValueOnce({
      remote: 'git@github.com:user/vault.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
      daemonLabel: 'my-vault',
    });
    mockIsLocked.mockResolvedValueOnce({ locked: false });
    mockGitInstance.revparse.mockResolvedValueOnce('main\n');
    mockGitInstance.getRemotes.mockResolvedValueOnce([]);
    mockGitInstance.raw.mockResolvedValueOnce('');
    mockGitInstance.log.mockResolvedValueOnce({ latest: null });

    const mockPlatform = {
      status: vi.fn().mockResolvedValue({ state: 'running', pid: 1234 }),
      isAutostartEnabled: vi.fn().mockResolvedValue(true),
    };
    mockGetPlatform.mockReturnValue(mockPlatform);
    mockGenerateServiceName.mockReturnValue('com.syncthis.my-vault');

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('\nService:');
    expect(logSpy).toHaveBeenCalledWith('  Status:    running (PID 1234)');
    expect(logSpy).toHaveBeenCalledWith('  Label:     my-vault');
    expect(logSpy).toHaveBeenCalledWith('  Autostart: on');
  });

  it('shows "not installed" when no service exists', async () => {
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

    const mockPlatform = {
      status: vi.fn().mockResolvedValue({ state: 'not-installed' }),
    };
    mockGetPlatform.mockReturnValue(mockPlatform);
    mockGenerateServiceName.mockReturnValue('com.syncthis.test');

    await handleStatus({ path: '/tmp/test' });

    expect(logSpy).toHaveBeenCalledWith('\nService: not installed');
  });

  it('skips service section when platform is not supported', async () => {
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

    // getPlatform throws (unsupported platform) — default from beforeEach
    await handleStatus({ path: '/tmp/test' });

    const allCalls = logSpy.mock.calls.flat().join('\n');
    expect(allCalls).not.toContain('Service:');
    expect(allCalls).not.toContain('Service: not installed');
  });
});

describe('handleStatus --all', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  it('calls printDaemonTable with all services when platform returns daemons', async () => {
    const daemons = [
      {
        serviceName: 'com.syncthis.vault',
        label: 'vault',
        dirPath: '/vault',
        state: 'running',
        autostart: false,
        schedule: '*/5 * * * *',
      },
    ];
    const mockPlatform = { listAll: vi.fn().mockResolvedValue(daemons) };
    mockGetPlatform.mockReturnValue(mockPlatform);

    await handleStatus({ path: '/tmp/test', all: true });

    expect(mockPrintDaemonTable).toHaveBeenCalledWith(daemons);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints "No syncthis services registered" when no daemons', async () => {
    const mockPlatform = { listAll: vi.fn().mockResolvedValue([]) };
    mockGetPlatform.mockReturnValue(mockPlatform);

    await handleStatus({ path: '/tmp/test', all: true });

    expect(logSpy).toHaveBeenCalledWith('No syncthis services registered.');
    expect(mockPrintDaemonTable).not.toHaveBeenCalled();
  });

  it('exits with code 1 when platform throws', async () => {
    mockGetPlatform.mockImplementation(() => {
      throw new Error('Unsupported platform');
    });

    await handleStatus({ path: '/tmp/test', all: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('handleStatus default behavior (no explicit --path)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetPlatform.mockImplementation(() => {
      throw new Error('Unsupported platform');
    });
    mockIsRebaseInProgress.mockResolvedValue(false);
  });

  it('shows "no config" hint when CWD has no .syncthis.json and --path not explicit', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await handleStatus({ path: '/tmp/test', pathExplicit: false });

    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('No syncthis config found in current directory');
    expect(allOutput).toContain('syncthis status --all');
    expect(allOutput).not.toContain('Not initialized');
  });

  it('shows "Not initialized" when --path was explicitly set and config missing', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await handleStatus({ path: '/tmp/test', pathExplicit: true });

    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Not initialized');
    expect(allOutput).not.toContain('No syncthis config found');
  });

  it('appends --all hint after single-dir status when --path not explicit', async () => {
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

    await handleStatus({ path: '/tmp/test', pathExplicit: false });

    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('syncthis status --all');
  });

  it('does not append --all hint when --path was explicit', async () => {
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

    await handleStatus({ path: '/tmp/test', pathExplicit: true });

    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).not.toContain('syncthis status --all');
  });
});
