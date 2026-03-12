import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStart } from '../../src/commands/start.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGit = vi.hoisted(() => ({
  raw: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  revparse: vi.fn(),
}));
vi.mock('simple-git', () => ({ default: vi.fn(() => mockGit) }));

const { mockRunSyncCycle } = vi.hoisted(() => ({ mockRunSyncCycle: vi.fn() }));
vi.mock('../../src/sync.js', () => ({ runSyncCycle: mockRunSyncCycle }));

const { mockLoadConfig, mockMergeWithFlags } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockMergeWithFlags: vi.fn((config: unknown) => config),
}));
vi.mock('../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  mergeWithFlags: mockMergeWithFlags,
}));

const { mockAcquireLock, mockReleaseLock, mockReadLockFile } = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockReadLockFile: vi
    .fn()
    .mockResolvedValue({ pid: process.pid, startedAt: new Date().toISOString() }),
}));
vi.mock('../../src/lock.js', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  readLockFile: mockReadLockFile,
}));

const { mockUpdateHealthAfterCycle } = vi.hoisted(() => ({
  mockUpdateHealthAfterCycle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/health.js', () => ({
  updateHealthAfterCycle: mockUpdateHealthAfterCycle,
}));

let capturedSchedulerCallback: (() => Promise<void>) | null = null;
const { mockStartScheduler } = vi.hoisted(() => ({ mockStartScheduler: vi.fn() }));
vi.mock('../../src/scheduler.js', () => ({ startScheduler: mockStartScheduler }));

const { mockCreateLogger } = vi.hoisted(() => ({ mockCreateLogger: vi.fn() }));
vi.mock('../../src/logger.js', () => ({ createLogger: mockCreateLogger }));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: null, stdout: string) => void;
    callback(null, 'git version 2.x');
  }),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  remote: 'git@github.com:user/vault.git',
  branch: 'main',
  cron: '*/5 * * * *',
  interval: null,
  onConflict: 'stop' as const,
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockSchedulerHandle = { stop: vi.fn() };

let mockExit: ReturnType<typeof vi.spyOn>;

const FOREGROUND_FLAGS = { path: '/repo', foreground: true as const, logLevel: 'info' };

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedSchedulerCallback = null;

  mockExit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);

  mockLoadConfig.mockResolvedValue({ ...BASE_CONFIG });
  mockMergeWithFlags.mockImplementation((config: unknown) => config);
  mockAcquireLock.mockResolvedValue(undefined);
  mockReleaseLock.mockResolvedValue(undefined);
  mockCreateLogger.mockReturnValue(mockLogger);
  mockRunSyncCycle.mockResolvedValue({ status: 'no-changes' });
  mockStartScheduler.mockImplementation((_config: unknown, callback: () => Promise<void>) => {
    capturedSchedulerCallback = callback;
    return mockSchedulerHandle;
  });

  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
});

afterEach(() => {
  mockExit.mockRestore();
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleStart – VALID_ON_CONFLICT includes ask', () => {
  it('--on-conflict ask → validation passes, no exit', async () => {
    await handleStart({ ...FOREGROUND_FLAGS, onConflict: 'ask' });

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('--on-conflict invalid-value → exits with validation error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleStart({ ...FOREGROUND_FLAGS, onConflict: 'invalid-value' })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --on-conflict'));
    consoleErrorSpy.mockRestore();
  });
});

describe('handleStart – ask + non-TTY (daemon) conflict handling', () => {
  beforeEach(() => {
    mockLoadConfig.mockResolvedValue({ ...BASE_CONFIG, onConflict: 'ask' });
    mockMergeWithFlags.mockImplementation((config: unknown) => config);
    // isTTY is undefined (falsy) by default from outer beforeEach
  });

  it('initial sync conflict → no process.exit, scheduler starts', async () => {
    mockRunSyncCycle.mockResolvedValue({
      status: 'conflict',
      error: 'Awaiting interactive resolution',
    });

    await handleStart(FOREGROUND_FLAGS);

    expect(mockExit).not.toHaveBeenCalled();
    expect(mockStartScheduler).toHaveBeenCalled();
  });

  it('scheduler callback conflict → no process.exit, callback returns normally', async () => {
    mockRunSyncCycle
      .mockResolvedValueOnce({ status: 'no-changes' }) // initial sync
      .mockResolvedValue({ status: 'conflict', error: 'Rebase in progress' }); // scheduler

    await handleStart(FOREGROUND_FLAGS);
    await capturedSchedulerCallback!();

    expect(mockExit).not.toHaveBeenCalled();
    expect(mockReleaseLock).not.toHaveBeenCalledTimes(2);
  });
});

describe('handleStart – ask + TTY conflict → exits as before', () => {
  beforeEach(() => {
    mockLoadConfig.mockResolvedValue({ ...BASE_CONFIG, onConflict: 'ask' });
    mockMergeWithFlags.mockImplementation((config: unknown) => config);
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  it('initial sync conflict + TTY → process.exit(1)', async () => {
    mockRunSyncCycle.mockResolvedValue({ status: 'conflict' });

    await expect(handleStart(FOREGROUND_FLAGS)).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockStartScheduler).not.toHaveBeenCalled();
  });

  it('scheduler callback conflict + TTY → process.exit(1)', async () => {
    mockRunSyncCycle
      .mockResolvedValueOnce({ status: 'no-changes' })
      .mockResolvedValue({ status: 'conflict' });

    await handleStart(FOREGROUND_FLAGS);
    await expect(capturedSchedulerCallback!()).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe('handleStart – stop/auto-both + conflict → exits as before', () => {
  it('stop + initial sync conflict → process.exit(1)', async () => {
    mockRunSyncCycle.mockResolvedValue({ status: 'conflict' });

    await expect(handleStart(FOREGROUND_FLAGS)).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockStartScheduler).not.toHaveBeenCalled();
  });

  it('auto-both + scheduler callback conflict → process.exit(1)', async () => {
    mockLoadConfig.mockResolvedValue({ ...BASE_CONFIG, onConflict: 'auto-both' });
    mockRunSyncCycle
      .mockResolvedValueOnce({ status: 'no-changes' })
      .mockResolvedValue({ status: 'conflict' });

    await handleStart(FOREGROUND_FLAGS);
    await expect(capturedSchedulerCallback!()).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('stop + scheduler callback conflict → process.exit(1)', async () => {
    mockRunSyncCycle
      .mockResolvedValueOnce({ status: 'no-changes' })
      .mockResolvedValue({ status: 'conflict' });

    await handleStart(FOREGROUND_FLAGS);
    await expect(capturedSchedulerCallback!()).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
