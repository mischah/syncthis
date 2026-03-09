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

vi.mock('../../src/lock.js', () => ({
  isLocked: vi.fn().mockResolvedValue({ locked: false }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

import {
  daemonLogs,
  daemonStart,
  daemonStop,
  daemonUninstall,
  handleList,
} from '../../src/commands/daemon.js';
import { loadConfig, writeConfig } from '../../src/config.js';
import type { DaemonInfo, DaemonPlatform, DaemonStatus } from '../../src/daemon/platform.js';
import { getPlatform } from '../../src/daemon/platform.js';
import { isLocked, releaseLock } from '../../src/lock.js';

const mockGetPlatform = vi.mocked(getPlatform);
const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockIsLocked = vi.mocked(isLocked);
const mockReleaseLock = vi.mocked(releaseLock);

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
  mockIsLocked.mockResolvedValue({ locked: false });
  mockReleaseLock.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// daemonStart
// ---------------------------------------------------------------------------

describe('daemonStart', () => {
  it('exits with error when .syncthis.json is missing', async () => {
    mockLoadConfig.mockRejectedValue(new Error("Not initialized. Run 'syncthis init' first."));
    const platform = makeMockPlatform();
    mockGetPlatform.mockReturnValue(platform);

    await expect(daemonStart({ path: tempDir })).rejects.toThrow('process.exit(1)');
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
    const promise = daemonStart({ path: tempDir });
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
    const promise = daemonStart({ path: tempDir, interval: 10 });
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
    const promise = daemonStart({ path: tempDir, cron: '*/2 * * * *' });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.install).toHaveBeenCalledWith(
      expect.objectContaining({ cron: '*/2 * * * *', interval: undefined }),
    );
  });

  it('preserves autostart when --enable-autostart is not passed', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig, autostart: true });
    const platform = makeMockPlatform({
      status: vi
        .fn()
        .mockResolvedValueOnce({ state: 'stopped' } as DaemonStatus)
        .mockResolvedValueOnce({ state: 'running', pid: 1 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    vi.useFakeTimers();
    // enableAutostart: false simulates real CLI behavior (meow default: false)
    const promise = daemonStart({ path: tempDir, enableAutostart: false });
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

    await daemonStart({ path: tempDir });

    expect(platform.install).not.toHaveBeenCalled();
    expect(platform.start).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Info: Daemon already running'),
    );
  });

  it('prints Info message and skips install when a foreground process is running via lock file', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig });
    mockIsLocked.mockResolvedValue({ locked: true, pid: 5555 });
    const platform = makeMockPlatform();
    mockGetPlatform.mockReturnValue(platform);

    await daemonStart({ path: tempDir });

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
    const promise = daemonStart({ path: tempDir, label: 'my-vault' });
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
    const promise = daemonStart({ path: tempDir, enableAutostart: true });
    await vi.runAllTimersAsync();
    await promise;

    expect(platform.enableAutostart).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// daemonStop
// ---------------------------------------------------------------------------

describe('daemonStop', () => {
  it('exits with error when no service is installed', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await expect(daemonStop({ path: tempDir })).rejects.toThrow('process.exit(1)');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No service found'));
  });

  it('kills foreground process via lock file when no service is installed', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    mockIsLocked.mockResolvedValue({ locked: true, pid: 16140 });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    await daemonStop({ path: tempDir });

    expect(killSpy).toHaveBeenCalledWith(16140, 'SIGTERM');
    expect(mockReleaseLock).toHaveBeenCalledWith(tempDir);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Foreground process stopped'));
  });

  it('calls stop when service is running', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'running', pid: 42 } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await daemonStop({ path: tempDir });

    expect(platform.stop).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
  });

  it('prints Info message when service is already stopped', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await daemonStop({ path: tempDir });

    expect(platform.stop).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('already stopped'));
  });
});

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

describe('handleList', () => {
  it('prints message when no services are registered', async () => {
    const platform = makeMockPlatform({
      listAll: vi.fn().mockResolvedValue([]),
    });
    mockGetPlatform.mockReturnValue(platform);

    await handleList();

    expect(platform.listAll).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith('No syncthis services registered.');
  });

  it('displays list of running services when listAll returns results', async () => {
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

    await handleList();

    const logCalls = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(logCalls).toContain('user-vault');
    expect(logCalls).toContain('running');
  });
});

// ---------------------------------------------------------------------------
// daemonUninstall
// ---------------------------------------------------------------------------

describe('daemonUninstall', () => {
  it('prints Info message when service is not installed, does not call uninstall', async () => {
    mockLoadConfig.mockRejectedValue(new Error('no config'));
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'not-installed' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await daemonUninstall({ path: tempDir });

    expect(platform.uninstall).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Nothing to uninstall'));
  });

  it('uninstalls an installed service and clears daemonLabel from config', async () => {
    mockLoadConfig.mockResolvedValue({ ...baseConfig, daemonLabel: 'my-vault' });
    const platform = makeMockPlatform({
      status: vi.fn().mockResolvedValue({ state: 'stopped' } as DaemonStatus),
    });
    mockGetPlatform.mockReturnValue(platform);

    await daemonUninstall({ path: tempDir });

    expect(platform.uninstall).toHaveBeenCalledOnce();
    expect(mockWriteConfig).toHaveBeenCalledWith(
      tempDir,
      expect.objectContaining({ daemonLabel: null }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Service uninstalled'));
  });
});

// ---------------------------------------------------------------------------
// daemonLogs
// ---------------------------------------------------------------------------

describe('daemonLogs', () => {
  it('prints the last N lines when the log file exists', async () => {
    const logDir = join(tempDir, '.syncthis', 'logs');
    await mkdir(logDir, { recursive: true });
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i + 1}`);
    await writeFile(join(logDir, 'syncthis.log'), `${lines.join('\n')}\n`, 'utf8');

    await daemonLogs({ path: tempDir, lines: 50 });

    const logOutput = vi.mocked(console.log).mock.calls[0][0] as string;
    const outputLines = logOutput.split('\n').filter(Boolean);
    expect(outputLines).toHaveLength(50);
    expect(logOutput).toContain('log line 100');
    expect(logOutput).toContain('log line 51');
  });

  it('exits with error when the log file does not exist', async () => {
    await expect(daemonLogs({ path: tempDir, lines: 50 })).rejects.toThrow('process.exit(1)');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No log file found'));
  });
});
