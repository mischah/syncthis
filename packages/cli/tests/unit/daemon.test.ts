import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPlatform = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/platform.js', () => ({
  getPlatform: mockGetPlatform,
  getNodeBinDir: vi.fn(() => '/usr/local/bin'),
  getSyncthisBinary: vi.fn(() => '/usr/local/bin/syncthis'),
}));

const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockWriteConfig = vi.hoisted(() => vi.fn());
const mockMergeWithFlags = vi.hoisted(() => vi.fn((c: unknown) => c));
vi.mock('../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  writeConfig: mockWriteConfig,
  mergeWithFlags: mockMergeWithFlags,
}));

const mockIsLocked = vi.hoisted(() => vi.fn());
const mockReleaseLock = vi.hoisted(() => vi.fn());
vi.mock('../../src/lock.js', () => ({
  isLocked: mockIsLocked,
  releaseLock: mockReleaseLock,
}));

const mockGenerateServiceName = vi.hoisted(() => vi.fn());
vi.mock('../../src/daemon/service-name.js', () => ({
  generateServiceName: mockGenerateServiceName,
}));

import {
  type BatchResult,
  daemonStop,
  daemonUninstall,
  printBatchSummary,
} from '../../src/commands/daemon.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaemon(
  overrides: Partial<{
    serviceName: string;
    label: string;
    dirPath: string;
    state: 'running' | 'stopped';
    pid: number;
    autostart: boolean;
    schedule: string;
  }> = {},
) {
  return {
    serviceName: overrides.serviceName ?? 'com.syncthis.my-vault',
    label: overrides.label ?? 'my-vault',
    dirPath: overrides.dirPath ?? '/Users/me/vault',
    state: overrides.state ?? 'running',
    pid: overrides.pid,
    autostart: overrides.autostart ?? false,
    schedule: overrides.schedule ?? '*/5 * * * *',
  };
}

// ---------------------------------------------------------------------------
// printBatchSummary
// ---------------------------------------------------------------------------

describe('printBatchSummary', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints checkmark for ok results', () => {
    const results: BatchResult[] = [
      { label: 'vault', dirPath: '/vault', outcome: 'ok', message: 'stopped' },
    ];
    printBatchSummary(results);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓ vault'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stopped'));
  });

  it('prints cross for failed results', () => {
    const results: BatchResult[] = [
      { label: 'vault', dirPath: '/vault', outcome: 'failed', message: 'some error' },
    ];
    printBatchSummary(results);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✗ vault'));
  });

  it('prints dash for skipped results', () => {
    const results: BatchResult[] = [
      { label: 'vault', dirPath: '/vault', outcome: 'skipped', message: 'already stopped' },
    ];
    printBatchSummary(results);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- vault'));
  });

  it('prints correct summary counts for mixed results', () => {
    const results: BatchResult[] = [
      { label: 'a', dirPath: '/a', outcome: 'ok', message: 'stopped' },
      { label: 'b', dirPath: '/b', outcome: 'ok', message: 'stopped' },
      { label: 'c', dirPath: '/c', outcome: 'skipped', message: 'already stopped' },
      { label: 'd', dirPath: '/d', outcome: 'failed', message: 'error' },
    ];
    printBatchSummary(results);
    const summaryCall = logSpy.mock.calls.find((call) => String(call[0]).includes('services:'));
    expect(summaryCall?.[0]).toContain('4 services');
    expect(summaryCall?.[0]).toContain('2 succeeded');
    expect(summaryCall?.[0]).toContain('1 skipped');
    expect(summaryCall?.[0]).toContain('1 failed');
  });

  it('uses singular "service" for 1 result', () => {
    const results: BatchResult[] = [
      { label: 'a', dirPath: '/a', outcome: 'ok', message: 'stopped' },
    ];
    printBatchSummary(results);
    const summaryCall = logSpy.mock.calls.find((call) => String(call[0]).includes('service'));
    expect(summaryCall?.[0]).toContain('1 service:');
  });
});

// ---------------------------------------------------------------------------
// daemonStop --all
// ---------------------------------------------------------------------------

describe('daemonStop --all', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let mockPlatform: {
    listAll: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockPlatform = {
      listAll: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
    };
    mockGetPlatform.mockReturnValue(mockPlatform);
  });

  it('stops all running services and skips stopped ones', async () => {
    mockPlatform.listAll.mockResolvedValue([
      makeDaemon({
        label: 'vault',
        dirPath: '/vault',
        state: 'running',
        serviceName: 'com.syncthis.vault',
      }),
      makeDaemon({
        label: 'notes',
        dirPath: '/notes',
        state: 'stopped',
        serviceName: 'com.syncthis.notes',
      }),
    ]);

    await daemonStop({ path: '/unused', all: true });

    expect(mockPlatform.stop).toHaveBeenCalledWith('com.syncthis.vault');
    expect(mockPlatform.stop).not.toHaveBeenCalledWith('com.syncthis.notes');
    expect(exitSpy).not.toHaveBeenCalled();
    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('✓ vault');
    expect(allOutput).toContain('- notes');
    expect(allOutput).toContain('1 succeeded');
    expect(allOutput).toContain('1 skipped');
  });

  it('continues stopping remaining services when one fails', async () => {
    mockPlatform.listAll.mockResolvedValue([
      makeDaemon({
        label: 'vault',
        dirPath: '/vault',
        state: 'running',
        serviceName: 'com.syncthis.vault',
      }),
      makeDaemon({
        label: 'notes',
        dirPath: '/notes',
        state: 'running',
        serviceName: 'com.syncthis.notes',
      }),
    ]);
    mockPlatform.stop
      .mockRejectedValueOnce(new Error('launchctl error'))
      .mockResolvedValueOnce(undefined);

    await daemonStop({ path: '/unused', all: true });

    expect(mockPlatform.stop).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('✗ vault');
    expect(allOutput).toContain('✓ notes');
  });

  it('prints message and returns early when no services registered', async () => {
    mockPlatform.listAll.mockResolvedValue([]);

    await daemonStop({ path: '/unused', all: true });

    expect(mockPlatform.stop).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('No syncthis services registered.');
  });
});

// ---------------------------------------------------------------------------
// daemonUninstall --all
// ---------------------------------------------------------------------------

describe('daemonUninstall --all', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let mockPlatform: {
    listAll: ReturnType<typeof vi.fn>;
    uninstall: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockPlatform = {
      listAll: vi.fn(),
      uninstall: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
    };
    mockGetPlatform.mockReturnValue(mockPlatform);
    mockLoadConfig.mockResolvedValue({
      remote: 'git@github.com:x/y.git',
      branch: 'main',
      cron: '*/5 * * * *',
      interval: null,
    });
    mockWriteConfig.mockResolvedValue(undefined);
  });

  it('uninstalls all services', async () => {
    mockPlatform.listAll.mockResolvedValue([
      makeDaemon({ label: 'vault', dirPath: '/vault', serviceName: 'com.syncthis.vault' }),
      makeDaemon({ label: 'notes', dirPath: '/notes', serviceName: 'com.syncthis.notes' }),
    ]);

    await daemonUninstall({ path: '/unused', all: true });

    expect(mockPlatform.uninstall).toHaveBeenCalledWith('com.syncthis.vault');
    expect(mockPlatform.uninstall).toHaveBeenCalledWith('com.syncthis.notes');
    expect(exitSpy).not.toHaveBeenCalled();
    const allOutput = logSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('2 succeeded');
  });

  it('continues when one uninstall fails', async () => {
    mockPlatform.listAll.mockResolvedValue([
      makeDaemon({ label: 'vault', dirPath: '/vault', serviceName: 'com.syncthis.vault' }),
      makeDaemon({ label: 'notes', dirPath: '/notes', serviceName: 'com.syncthis.notes' }),
    ]);
    mockPlatform.uninstall
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);

    await daemonUninstall({ path: '/unused', all: true });

    expect(mockPlatform.uninstall).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints message and returns early when no services registered', async () => {
    mockPlatform.listAll.mockResolvedValue([]);

    await daemonUninstall({ path: '/unused', all: true });

    expect(mockPlatform.uninstall).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('No syncthis services registered.');
  });
});
