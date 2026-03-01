import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module mocks (hoisted) ---

vi.mock('../../src/daemon/platform.js', () => ({
  getNodeBinDir: vi.fn().mockReturnValue('/usr/local/bin'),
  getPlatform: vi.fn(),
  getSyncthisBinary: vi.fn().mockReturnValue('/usr/local/bin/syncthis'),
}));

vi.mock('../../src/config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config.js')>();
  return {
    loadConfig: vi.fn(),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    mergeWithFlags: original.mergeWithFlags,
  };
});

import { handleDaemon } from '../../src/commands/daemon.js';
import { loadConfig, writeConfig } from '../../src/config.js';
import type { DaemonInfo, DaemonPlatform, DaemonStatus } from '../../src/daemon/platform.js';
import { getPlatform } from '../../src/daemon/platform.js';

const mockGetPlatform = vi.mocked(getPlatform);
const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteConfig = vi.mocked(writeConfig);

// --- Helpers ---

function makeMockPlatform(overrides: Partial<DaemonPlatform> = {}): DaemonPlatform {
  return {
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    listAll: vi.fn().mockResolvedValue([] as DaemonInfo[]),
    enableAutostart: vi.fn().mockResolvedValue(undefined),
    disableAutostart: vi.fn().mockResolvedValue(undefined),
    isAutostartEnabled: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const baseConfig = {
  remote: 'git@github.com:user/vault.git',
  branch: 'main',
  cron: '*/5 * * * *',
  interval: null,
};

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-daemon-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?) => {
    throw new Error(`process.exit(${code ?? ''})`);
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// daemon start
// ---------------------------------------------------------------------------

describe('daemon start', () => {
  it('exits with error when .syncthis.json is missing', async () => {
    mockLoadConfig.mockRejectedValue(new Error("Not initialized. Run 'syncthis init' first."));
    const platform = makeMockPlatform();
    mockGetPlatform.mockReturnValue(platform);

    await expect(handleDaemon('start', { path: tempDir })).rejects.toThrow('process.exit(1)');
    expect(console.error).toHaveBeenCalledWith(
      "Error: Not initialized. Run 'syncthis init' first.",
    );
  });

  it('calls install and start when service is not yet installed', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'not-installed' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1234 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.install).toHaveBeenCalledOnce();
    expect(platform.start).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Daemon started'));
  });

  it('reinstalls and starts when service is stopped (e.g. config changed)', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'stopped' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 5678 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir, interval: 10 });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.install).toHaveBeenCalledOnce();
    expect(platform.install).toHaveBeenCalledWith(
      expect.objectContaining({ interval: 10, cron: undefined }),
    );
    expect(platform.start).toHaveBeenCalledOnce();
    expect(mockWriteConfig).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({ interval: 10, cron: null }),
    );
  });

  it('--cron flag overrides config interval', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig, cron: null, interval: 300 });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'not-installed' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir, cron: '*/2 * * * *' });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.install).toHaveBeenCalledWith(
      expect.objectContaining({ cron: '*/2 * * * *', interval: undefined }),
    );
  });

  it('preserves autostart when --enable-autostart is not passed', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'stopped' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1 } as DaemonStatus),
      isAutostartEnabled: vi.fn().mockResolvedValue(true),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.install).toHaveBeenCalledWith(expect.objectContaining({ autostart: true }));
    expect(platform.enableAutostart).toHaveBeenCalledOnce();
  });

  it('prints Info message and skips install when already running', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'running', pid: 999 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('start', { path: tempDir });

    expect(platform.install).not.toHaveBeenCalled();
    expect(platform.start).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Info: Daemon already running'),
    );
  });

  it('writes daemonLabel to config after a successful start', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'not-installed' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir, label: 'my-vault' });
    await vi.runAllTimersAsync();
    await promise;

    expect(mockWriteConfig).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({ daemonLabel: 'my-vault' }),
    );
  });

  it('calls enableAutostart when --enable-autostart flag is set', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'not-installed' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    const promise = handleDaemon('start', { path: tempDir, enableAutostart: true });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.enableAutostart).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// daemon stop
// ---------------------------------------------------------------------------

describe('daemon stop', () => {
  it('exits with error when no service is installed', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await expect(handleDaemon('stop', { path: tempDir })).rejects.toThrow('process.exit(1)');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No daemon found'));
  });

  it('calls stop when service is running', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'running', pid: 42 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('stop', { path: tempDir });

    expect(platform.stop).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
  });

  it('prints Info message when service is already stopped', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('stop', { path: tempDir });

    expect(platform.stop).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('already stopped'));
  });
});

// ---------------------------------------------------------------------------
// daemon status
// ---------------------------------------------------------------------------

describe('daemon status', () => {
  it('calls listAll when no --path or --label is given', async () => {
    const platform = makeMockPlatform({
      listAll: vi.fn().mockResolvedValue([]),
    });
    mockGetPlatform.mockReturnValue(platform);

    // process.argv in vitest does not contain --path, so listAll branch is taken
    await handleDaemon('status', { path: process.cwd() });

    expect(platform.listAll).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith('No syncthis daemons registered.');
  });

  it('displays list of running daemons when listAll returns results', async () => {
    const daemons: DaemonInfo[] = [
      {
        serviceName: 'com.syncthis.user-vault',
        label: 'user-vault',
        dirPath: '/home/user/vault',
        state: 'running',
        pid: 1234,
        autostart: false,
        schedule: '*/5 * * * *',
      },
    ];
    const platform = makeMockPlatform({
      listAll: vi.fn().mockResolvedValue(daemons),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('status', { path: process.cwd() });

    const logCalls = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(logCalls).toContain('user-vault');
    expect(logCalls).toContain('running');
  });

  it('queries single status when --label is given', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('status', { path: tempDir, label: 'my-vault' });

    expect(platform.status).toHaveBeenCalledOnce();
    expect(platform.listAll).not.toHaveBeenCalled();
    const logCalls = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(logCalls).toContain('my-vault');
  });

  it('queries single status when --path is in process.argv', async () => {
    const originalArgv = process.argv;
    process.argv = [...originalArgv, '--path', tempDir];

    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    try {
      await handleDaemon('status', { path: tempDir });
    } finally {
      process.argv = originalArgv;
    }

    expect(platform.status).toHaveBeenCalledOnce();
    expect(platform.listAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// daemon uninstall
// ---------------------------------------------------------------------------

describe('daemon uninstall', () => {
  it('prints Info message when service is not installed, does not call uninstall', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('uninstall', { path: tempDir });

    expect(platform.uninstall).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Nothing to uninstall'));
  });

  it('uninstalls an installed service and clears daemonLabel from config', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig, daemonLabel: 'my-vault' });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleDaemon('uninstall', { path: tempDir });

    expect(platform.uninstall).toHaveBeenCalledOnce();
    expect(mockWriteConfig).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({ daemonLabel: null }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Daemon uninstalled'));
  });
});

// ---------------------------------------------------------------------------
// daemon logs
// ---------------------------------------------------------------------------

describe('daemon logs', () => {
  it('prints the last N lines when the log file exists', async () => {
    const logDir = join(tempDir, '.syncthis', 'logs');
    await mkdir(logDir, { recursive: true });
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i + 1}`);
    await writeFile(join(logDir, 'syncthis.log'), `${lines.join('\n')}\n`, 'utf8');

    await handleDaemon('logs', { path: tempDir, lines: 50 });

    const logOutput = vi.mocked(console.log).mock.calls[0][0] as string;
    const outputLines = logOutput.split('\n').filter(Boolean);
    expect(outputLines).toHaveLength(50);
    expect(logOutput).toContain('log line 100');
    expect(logOutput).toContain('log line 51');
  });

  it('exits with error when the log file does not exist', async () => {
    await expect(handleDaemon('logs', { path: tempDir, lines: 50 })).rejects.toThrow(
      'process.exit(1)',
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No log file found'));
  });
});
