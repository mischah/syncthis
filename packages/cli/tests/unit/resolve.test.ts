import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleResolve } from '../../src/commands/resolve.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGit = vi.hoisted(() => ({
  raw: vi.fn(),
  push: vi.fn(),
  revparse: vi.fn(),
}));
vi.mock('simple-git', () => ({ default: vi.fn(() => mockGit) }));

const { mockLoadConfig } = vi.hoisted(() => ({ mockLoadConfig: vi.fn() }));
vi.mock('../../src/config.js', () => ({ loadConfig: mockLoadConfig }));

const { mockIsRebaseInProgress, mockGetConflictFiles } = vi.hoisted(() => ({
  mockIsRebaseInProgress: vi.fn(),
  mockGetConflictFiles: vi.fn(),
}));
vi.mock('../../src/conflict/resolver.js', () => ({
  isRebaseInProgress: mockIsRebaseInProgress,
  getConflictFiles: mockGetConflictFiles,
}));

const { mockResolveInteractive } = vi.hoisted(() => ({ mockResolveInteractive: vi.fn() }));
vi.mock('../../src/conflict/interactive.js', () => ({
  resolveInteractive: mockResolveInteractive,
}));

const { mockAccess } = vi.hoisted(() => ({ mockAccess: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: mockAccess }));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  remote: 'git@github.com:user/vault.git',
  branch: 'main',
  cron: '*/5 * * * *',
  interval: null,
  onConflict: 'auto-both' as const,
};

const RESOLVED_RESULT = {
  status: 'resolved' as const,
  resolvedFiles: ['file1.md'],
  conflictCopies: [],
  decisions: [{ filePath: 'file1.md', choice: 'local' as const }],
};

let mockExit: ReturnType<typeof vi.spyOn>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockExit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);

  mockAccess.mockResolvedValue(undefined);
  mockLoadConfig.mockResolvedValue({ ...BASE_CONFIG });
  mockIsRebaseInProgress.mockResolvedValue(true);
  mockGetConflictFiles.mockResolvedValue([{ filePath: 'file1.md' }]);
  mockResolveInteractive.mockResolvedValue(RESOLVED_RESULT);
  mockGit.raw.mockResolvedValue(undefined);
  mockGit.push.mockResolvedValue(undefined);
});

afterEach(() => {
  mockExit.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleResolve – preconditions', () => {
  it('no syncthis dir → error + exit 1', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    await expect(handleResolve({ path: '/repo' })).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not a syncthis directory'),
    );
    consoleErrorSpy.mockRestore();
  });

  it('no rebase in progress → info + exit 0', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockIsRebaseInProgress.mockResolvedValue(false);

    await expect(handleResolve({ path: '/repo' })).rejects.toThrow('process.exit(0)');

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No rebase in progress'));
    consoleLogSpy.mockRestore();
  });

  it('rebase in progress but no conflict files → info + exit 0', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetConflictFiles.mockResolvedValue([]);

    await expect(handleResolve({ path: '/repo' })).rejects.toThrow('process.exit(0)');

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('no conflicts found'));
    consoleLogSpy.mockRestore();
  });
});

describe('handleResolve – successful resolution', () => {
  it('calls resolveInteractive with correct args', async () => {
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([]);

    await handleResolve({ path: '/repo' });

    expect(mockResolveInteractive).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{ filePath: 'file1.md' }],
        dirPath: '/repo',
      }),
    );
  });

  it('calls git rebase --continue after resolving', async () => {
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([]);

    await handleResolve({ path: '/repo' });

    expect(mockGit.raw).toHaveBeenCalledWith(['-c', 'core.editor=true', 'rebase', '--continue']);
  });

  it('calls git push after resolving', async () => {
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([]);

    await handleResolve({ path: '/repo' });

    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');
  });

  it('shows success message after push', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([]);

    await handleResolve({ path: '/repo' });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pushed to origin'));
    consoleLogSpy.mockRestore();
  });
});

describe('handleResolve – cascading rebase', () => {
  it('loops through multiple conflict rounds (max 20 steps)', async () => {
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([{ filePath: 'file2.md' }])
      .mockResolvedValueOnce([]);
    mockResolveInteractive
      .mockResolvedValueOnce({ ...RESOLVED_RESULT, resolvedFiles: ['file1.md'] })
      .mockResolvedValueOnce({ ...RESOLVED_RESULT, resolvedFiles: ['file2.md'] });

    await handleResolve({ path: '/repo' });

    expect(mockResolveInteractive).toHaveBeenCalledTimes(2);
    expect(mockGit.raw).toHaveBeenCalledWith(['-c', 'core.editor=true', 'rebase', '--continue']);
    expect(mockGit.push).toHaveBeenCalledWith('origin', 'main');
  });
});

describe('handleResolve – push failure', () => {
  it('push fails → warning logged, no crash', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetConflictFiles
      .mockResolvedValueOnce([{ filePath: 'file1.md' }])
      .mockResolvedValueOnce([]);
    mockGit.push.mockRejectedValue(new Error('Network error'));

    await handleResolve({ path: '/repo' });

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('push failed'));
    expect(mockExit).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});

describe('handleResolve – cancelled / aborted', () => {
  it('cancelled → exit 1', async () => {
    mockResolveInteractive.mockResolvedValue({
      status: 'cancelled',
      resolvedFiles: [],
      conflictCopies: [],
      decisions: [],
    });

    await expect(handleResolve({ path: '/repo' })).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('aborted → exit 1', async () => {
    mockResolveInteractive.mockResolvedValue({
      status: 'aborted',
      resolvedFiles: [],
      conflictCopies: [],
      decisions: [],
    });

    await expect(handleResolve({ path: '/repo' })).rejects.toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockGit.push).not.toHaveBeenCalled();
  });
});
