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

const { mockResolveRebase, mockIsRebaseInProgress, mockGetConflictFiles } = vi.hoisted(() => ({
  mockResolveRebase: vi.fn(),
  mockIsRebaseInProgress: vi.fn(),
  mockGetConflictFiles: vi.fn(),
}));
vi.mock('../../src/conflict/resolver.js', () => ({
  resolveRebase: mockResolveRebase,
  isRebaseInProgress: mockIsRebaseInProgress,
  getConflictFiles: mockGetConflictFiles,
}));

const mockResolveInteractive = vi.hoisted(() => vi.fn());
vi.mock('../../src/conflict/interactive.js', () => ({
  resolveInteractive: mockResolveInteractive,
}));

const mockNotifyConflict = vi.hoisted(() => vi.fn());
vi.mock('../../src/conflict/notify.js', () => ({
  notifyConflict: mockNotifyConflict,
}));

const config: SyncthisConfig = {
  remote: 'git@github.com:user/vault.git',
  branch: 'main',
  cron: '*/5 * * * *',
  interval: null,
  onConflict: 'stop',
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
  mockNotifyConflict.mockReturnValue(undefined);
  mockIsRebaseInProgress.mockResolvedValue(false);
  mockGetConflictFiles.mockResolvedValue([]);
  // Reset isTTY to undefined (non-interactive) between tests
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
});

describe('runSyncCycle', () => {
  it('returns { status: "no-changes" } when no local or remote changes exist', async () => {
    // git status → empty, rev-parse HEAD (before) → same as after pull
    mockGit.raw
      .mockResolvedValueOnce('') // git status --porcelain
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce('abc1234\n'); // rev-parse HEAD (after pull)

    const result = await runSyncCycle('/repo', config, logger);

    expect(result).toEqual({ status: 'no-changes' });
    expect(mockGit.add).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', ['--rebase']);
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('returns { status: "pulled" } when no local changes but remote changes exist', async () => {
    mockGit.raw
      .mockResolvedValueOnce('') // git status --porcelain
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce('def5678\n'); // rev-parse HEAD (after pull — different!)

    const result = await runSyncCycle('/repo', config, logger);

    expect(result).toEqual({ status: 'pulled' });
    expect(mockGit.add).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', ['--rebase']);
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('returns { status: "network-error" } when pull fails and no local changes', async () => {
    mockGit.raw
      .mockResolvedValueOnce('') // git status --porcelain
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce(''); // git status --porcelain (post-pull conflict check)
    mockGit.pull.mockRejectedValue(new Error('network error'));

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('network-error');
    expect(logger.warn).toHaveBeenCalled();
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

  it('returns { status: "conflict" } and calls notifyConflict when rebase detects conflicts', async () => {
    mockGit.raw
      .mockResolvedValueOnce('M file1.md\n') // git status --porcelain
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce('UU file1.md\n'); // git status --porcelain (post-pull conflict check)
    mockGit.pull.mockRejectedValue(new Error('CONFLICTS'));

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('conflict');
    expect(result.filesChanged).toBe(1);
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-unresolved' }),
      logger,
    );
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

describe('runSyncCycle – conflict strategies', () => {
  function setupConflictScenario() {
    mockGit.raw
      .mockResolvedValueOnce('M file1.md\n') // git status --porcelain
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce('UU file1.md\n'); // post-pull status
    mockGit.pull.mockRejectedValue(new Error('CONFLICTS'));
  }

  it('onConflict: "stop" → notifyConflict with type "conflict-unresolved", returns { status: "conflict" }, no push', async () => {
    setupConflictScenario();

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'stop' }, logger);

    expect(result.status).toBe('conflict');
    expect(mockResolveRebase).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-unresolved', strategy: 'stop' }),
      logger,
    );
  });

  it('onConflict: "auto-both" → resolveRebase called, push, returns { status: "synced", conflictCopies }', async () => {
    setupConflictScenario();
    mockResolveRebase.mockResolvedValue({
      status: 'resolved',
      resolvedFiles: ['file1.md'],
      conflictCopies: ['file1.conflict-2025-03-04T14-30-00.md'],
      rebaseSteps: 1,
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'auto-both' }, logger);

    expect(result.status).toBe('synced');
    expect(result.conflictCopies).toEqual(['file1.conflict-2025-03-04T14-30-00.md']);
    expect(mockResolveRebase).toHaveBeenCalledWith(mockGit, 'auto-both', '/repo', logger);
    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-resolved', strategy: 'auto-both' }),
      logger,
    );
  });

  it('onConflict: "auto-newest" → resolveRebase called with "auto-newest", push, returns { status: "synced" }', async () => {
    setupConflictScenario();
    mockResolveRebase.mockResolvedValue({
      status: 'resolved',
      resolvedFiles: ['file1.md'],
      conflictCopies: [],
      rebaseSteps: 1,
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'auto-newest' }, logger);

    expect(result.status).toBe('synced');
    expect(mockResolveRebase).toHaveBeenCalledWith(mockGit, 'auto-newest', '/repo', logger);
    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-resolved', strategy: 'auto-newest' }),
      logger,
    );
  });

  it('resolver returns "aborted" → returns { status: "conflict", error: "Rebase limit reached" }, no push', async () => {
    setupConflictScenario();
    mockResolveRebase.mockResolvedValue({
      status: 'aborted',
      resolvedFiles: ['file1.md'],
      conflictCopies: [],
      rebaseSteps: 21,
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'auto-both' }, logger);

    expect(result.status).toBe('conflict');
    expect(result.error).toBe('Rebase limit reached');
    expect(mockGit.push).not.toHaveBeenCalled();
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-limit-reached' }),
      logger,
    );
  });

  it('onConflict: "stop" → no resolver called, notifyConflict with "conflict-unresolved"', async () => {
    setupConflictScenario();

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'stop' }, logger);

    expect(result.status).toBe('conflict');
    expect(mockResolveRebase).not.toHaveBeenCalled();
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-unresolved' }),
      logger,
    );
  });
});

describe('runSyncCycle – isRebaseInProgress check', () => {
  it('rebase in progress at start → skips sync, returns status conflict', async () => {
    mockIsRebaseInProgress.mockResolvedValue(true);

    const result = await runSyncCycle('/repo', config, logger);

    expect(result.status).toBe('conflict');
    expect(result.error).toBe('Rebase in progress');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Rebase in progress'));
    expect(mockGit.raw).not.toHaveBeenCalled();
  });
});

describe('runSyncCycle – ask strategy', () => {
  function setupConflictScenario() {
    mockGit.raw
      .mockResolvedValueOnce('M file1.md\n') // git status --porcelain -z
      .mockResolvedValueOnce('abc1234\n') // rev-parse HEAD (before pull)
      .mockResolvedValueOnce('UU file1.md\n'); // post-pull status -z
    mockGit.pull.mockRejectedValue(new Error('CONFLICTS'));
    mockGetConflictFiles.mockResolvedValueOnce([{ filePath: 'file1.md' }]);
  }

  it('ask + TTY + resolved → resolveInteractive called, push, status synced, interactiveDecisions set', async () => {
    setupConflictScenario();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockResolveInteractive.mockResolvedValue({
      status: 'resolved',
      resolvedFiles: ['file1.md'],
      conflictCopies: [],
      decisions: [{ filePath: 'file1.md', choice: 'local' }],
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'ask' }, logger);

    expect(result.status).toBe('synced');
    expect(mockResolveInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{ filePath: 'file1.md' }],
        dirPath: '/repo',
      }),
    );
    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');
    expect(result.interactiveDecisions).toEqual([{ filePath: 'file1.md', choice: 'local' }]);
  });

  it('ask + TTY + cancelled → status conflict, no push', async () => {
    setupConflictScenario();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockResolveInteractive.mockResolvedValue({
      status: 'cancelled',
      resolvedFiles: [],
      conflictCopies: [],
      decisions: [],
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'ask' }, logger);

    expect(result.status).toBe('conflict');
    expect(result.error).toBe('Resolution cancelled/aborted');
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('ask + TTY + aborted → status conflict, no push', async () => {
    setupConflictScenario();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockResolveInteractive.mockResolvedValue({
      status: 'aborted',
      resolvedFiles: [],
      conflictCopies: [],
      decisions: [],
    });

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'ask' }, logger);

    expect(result.status).toBe('conflict');
    expect(result.error).toBe('Resolution cancelled/aborted');
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('ask + no TTY → stop-like behavior, logs syncthis resolve hint, no resolveInteractive', async () => {
    setupConflictScenario();

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'ask' }, logger);

    expect(result.status).toBe('conflict');
    expect(result.error).toBe('Awaiting interactive resolution');
    expect(mockResolveInteractive).not.toHaveBeenCalled();
    expect(mockNotifyConflict).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conflict-unresolved', strategy: 'ask' }),
      logger,
    );
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('ask + no TTY → returns without calling process.exit', async () => {
    setupConflictScenario();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'ask' }, logger);

    expect(result.status).toBe('conflict');
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('default (stop) strategy → existing behavior unchanged, no resolveInteractive', async () => {
    setupConflictScenario();

    const result = await runSyncCycle('/repo', { ...config, onConflict: 'stop' }, logger);

    expect(result.status).toBe('conflict');
    expect(mockResolveInteractive).not.toHaveBeenCalled();
  });
});
