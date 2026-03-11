import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveInteractive } from '../../src/conflict/interactive.js';
import type { Logger } from '../../src/logger.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIntro, mockOutro, mockLogStep, mockSelect, mockIsCancel } = vi.hoisted(() => ({
  mockIntro: vi.fn(),
  mockOutro: vi.fn(),
  mockLogStep: vi.fn(),
  mockSelect: vi.fn(),
  mockIsCancel: vi.fn(() => false),
}));

vi.mock('@clack/prompts', () => ({
  intro: mockIntro,
  outro: mockOutro,
  log: { step: mockLogStep },
  select: mockSelect,
  isCancel: mockIsCancel,
}));

const { mockRenderConflictDiff, mockRenderStatusLine } = vi.hoisted(() => ({
  mockRenderConflictDiff: vi.fn(() => 'diff output'),
  mockRenderStatusLine: vi.fn(() => 'status line'),
}));

vi.mock('../../src/conflict/diff-renderer.js', () => ({
  renderConflictDiff: mockRenderConflictDiff,
  renderStatusLine: mockRenderStatusLine,
}));

const { mockResolveFile } = vi.hoisted(() => ({
  mockResolveFile: vi.fn(),
}));

vi.mock('../../src/conflict/resolver.js', () => ({
  resolveFile: mockResolveFile,
}));

const { mockResolveChunkByChunk, mockGetHunkCount } = vi.hoisted(() => ({
  mockResolveChunkByChunk: vi.fn(),
  mockGetHunkCount: vi.fn(() => 2),
}));

vi.mock('../../src/conflict/hunk-resolver.js', () => ({
  resolveChunkByChunk: mockResolveChunkByChunk,
  getHunkCount: mockGetHunkCount,
}));

const { mockWriteFile } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
}));

const mockGit = {
  raw: vi.fn(),
  add: vi.fn(),
};

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const FAKE_DIR = '/fake/repo';

const FILE_A = { filePath: 'notes/daily.md' };
const FILE_B = { filePath: 'notes/todo.md' };
const FILE_C = { filePath: 'notes/ideas.md' };

const LOCAL_CONTENT = 'local content\n';
const REMOTE_CONTENT = 'remote content\n';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCancel.mockReturnValue(false);
  mockResolveFile.mockResolvedValue({ action: 'ours' });
  mockResolveChunkByChunk.mockResolvedValue({ status: 'resolved', mergedContent: 'merged\n' });
  mockWriteFile.mockResolvedValue(undefined);
  mockGit.raw.mockImplementation((args: string[]) => {
    if (args[0] === 'show' && args[1]?.startsWith(':2:')) return Promise.resolve(LOCAL_CONTENT);
    if (args[0] === 'show' && args[1]?.startsWith(':3:')) return Promise.resolve(REMOTE_CONTENT);
    return Promise.resolve('');
  });
});

// ---------------------------------------------------------------------------
// resolveInteractive
// ---------------------------------------------------------------------------

describe('resolveInteractive', () => {
  it('empty file list: returns resolved immediately, no prompts', async () => {
    const result = await resolveInteractive({
      git: mockGit as never,
      files: [],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(result).toEqual({
      status: 'resolved',
      resolvedFiles: [],
      conflictCopies: [],
      decisions: [],
    });
    expect(mockIntro).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("user selects 'local': resolveFile called with userChoice 'local'", async () => {
    mockSelect.mockResolvedValue('local');

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveFile).toHaveBeenCalledWith(
      mockGit,
      FILE_A,
      'auto-both',
      expect.any(Date),
      FAKE_DIR,
      'local',
    );
    expect(result.status).toBe('resolved');
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'local' }]);
  });

  it("user selects 'remote': resolveFile called with userChoice 'remote'", async () => {
    mockSelect.mockResolvedValue('remote');
    mockResolveFile.mockResolvedValue({ action: 'theirs' });

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveFile).toHaveBeenCalledWith(
      mockGit,
      FILE_A,
      'auto-both',
      expect.any(Date),
      FAKE_DIR,
      'remote',
    );
    expect(result.status).toBe('resolved');
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'remote' }]);
  });

  it("user selects 'both': resolveFile called with userChoice 'both'", async () => {
    mockSelect.mockResolvedValue('both');
    mockResolveFile.mockResolvedValue({ action: 'both', conflictCopy: 'notes/daily.conflict.md' });

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveFile).toHaveBeenCalledWith(
      mockGit,
      FILE_A,
      'auto-both',
      expect.any(Date),
      FAKE_DIR,
      'both',
    );
    expect(result.status).toBe('resolved');
    expect(result.conflictCopies).toEqual(['notes/daily.conflict.md']);
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'both' }]);
  });

  it("user selects 'abort': git rebase --abort called, status 'aborted'", async () => {
    mockSelect.mockResolvedValue('abort');

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockGit.raw).toHaveBeenCalledWith(['rebase', '--abort']);
    expect(result.status).toBe('aborted');
    expect(result.resolvedFiles).toEqual([]);
    expect(result.decisions).toEqual([]);
  });

  it('abort at file 2/3: rebase aborted, file 1 decisions retained', async () => {
    mockSelect
      .mockResolvedValueOnce('local') // file 1
      .mockResolvedValueOnce('abort'); // file 2

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A, FILE_B, FILE_C],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockGit.raw).toHaveBeenCalledWith(['rebase', '--abort']);
    expect(result.status).toBe('aborted');
    // File 1 was resolved before abort
    expect(result.resolvedFiles).toEqual(['notes/daily.md']);
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'local' }]);
    // File 3 never processed
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it('progress: renderStatusLine called for each file', async () => {
    mockSelect.mockResolvedValue('local');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A, FILE_B, FILE_C],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockRenderStatusLine).toHaveBeenCalledWith(
      expect.objectContaining({ file: { index: 0, total: 3, resolved: 0 }, fileName: 'daily.md' }),
    );
    expect(mockRenderStatusLine).toHaveBeenCalledWith(
      expect.objectContaining({ file: { index: 1, total: 3, resolved: 1 }, fileName: 'todo.md' }),
    );
    expect(mockRenderStatusLine).toHaveBeenCalledWith(
      expect.objectContaining({ file: { index: 2, total: 3, resolved: 2 }, fileName: 'ideas.md' }),
    );
  });

  it('multiple files: all processed sequentially, decisions array correct', async () => {
    mockSelect
      .mockResolvedValueOnce('local')
      .mockResolvedValueOnce('remote')
      .mockResolvedValueOnce('both');
    mockResolveFile
      .mockResolvedValueOnce({ action: 'ours' })
      .mockResolvedValueOnce({ action: 'theirs' })
      .mockResolvedValueOnce({ action: 'both', conflictCopy: 'notes/ideas.conflict.md' });

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A, FILE_B, FILE_C],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(result.status).toBe('resolved');
    expect(result.resolvedFiles).toEqual(['notes/daily.md', 'notes/todo.md', 'notes/ideas.md']);
    expect(result.conflictCopies).toEqual(['notes/ideas.conflict.md']);
    expect(result.decisions).toEqual([
      { filePath: 'notes/daily.md', choice: 'local' },
      { filePath: 'notes/todo.md', choice: 'remote' },
      { filePath: 'notes/ideas.md', choice: 'both' },
    ]);
  });

  it("Ctrl+C (isCancel): status 'cancelled', git rebase --abort called", async () => {
    const cancelSymbol = Symbol('cancel');
    mockSelect.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockReturnValue(true);

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockGit.raw).toHaveBeenCalledWith(['rebase', '--abort']);
    expect(result.status).toBe('cancelled');
    expect(result.resolvedFiles).toEqual([]);
  });

  it('resolvedFiles and conflictCopies correctly filled', async () => {
    mockSelect.mockResolvedValue('both');
    mockResolveFile.mockResolvedValue({
      action: 'both',
      conflictCopy: 'notes/daily.conflict.md',
    });

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(result.resolvedFiles).toEqual(['notes/daily.md']);
    expect(result.conflictCopies).toEqual(['notes/daily.conflict.md']);
  });

  it('renderConflictDiff called with localContent and remoteContent', async () => {
    mockSelect.mockResolvedValue('local');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockRenderConflictDiff).toHaveBeenCalledWith(
      'notes/daily.md',
      LOCAL_CONTENT,
      REMOTE_CONTENT,
      { localLabel: 'local version', remoteLabel: 'remote version' },
    );
  });

  it('intro and outro called', async () => {
    mockSelect.mockResolvedValue('local');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockIntro).toHaveBeenCalledWith('syncthis – Conflict Resolution');
    expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('All conflicts resolved'));
  });

  it('outro not called when aborted', async () => {
    mockSelect.mockResolvedValue('abort');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockOutro).not.toHaveBeenCalled();
  });

  it('resolveFile not called when user cancels (isCancel)', async () => {
    const cancelSymbol = Symbol('cancel');
    mockSelect.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockReturnValue(true);

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveFile).not.toHaveBeenCalled();
  });

  it("user selects 'chunk-by-chunk': resolveChunkByChunk called, file written and staged", async () => {
    mockSelect.mockResolvedValue('chunk-by-chunk');

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveChunkByChunk).toHaveBeenCalledWith(
      LOCAL_CONTENT,
      REMOTE_CONTENT,
      'notes/daily.md',
      { index: 0, total: 1, resolved: 0 },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(`${FAKE_DIR}/notes/daily.md`, 'merged\n', 'utf8');
    expect(mockGit.raw).not.toHaveBeenCalledWith(['rebase', '--abort']);
    expect(result.status).toBe('resolved');
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'chunk-by-chunk' }]);
  });

  it("chunk-by-chunk 'back': returns to file menu, second choice resolves", async () => {
    mockSelect.mockResolvedValueOnce('chunk-by-chunk').mockResolvedValueOnce('local');
    mockResolveChunkByChunk.mockResolvedValue({ status: 'back' });

    const result = await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveChunkByChunk).toHaveBeenCalledTimes(1);
    expect(mockResolveFile).toHaveBeenCalledWith(
      mockGit,
      FILE_A,
      'auto-both',
      expect.any(Date),
      FAKE_DIR,
      'local',
    );
    expect(result.status).toBe('resolved');
    expect(result.decisions).toEqual([{ filePath: 'notes/daily.md', choice: 'local' }]);
  });

  it('chunk-by-chunk resolved: resolveFile not called', async () => {
    mockSelect.mockResolvedValue('chunk-by-chunk');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    expect(mockResolveFile).not.toHaveBeenCalled();
  });

  it('single hunk: chunk-by-chunk option not included in select options', async () => {
    mockGetHunkCount.mockReturnValue(1);
    mockSelect.mockResolvedValue('local');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    const options: Array<{ value: string }> = mockSelect.mock.calls[0][0].options;
    expect(options.some((o) => o.value === 'chunk-by-chunk')).toBe(false);
  });

  it('multiple hunks: chunk-by-chunk option included in select options', async () => {
    mockGetHunkCount.mockReturnValue(3);
    mockSelect.mockResolvedValue('local');

    await resolveInteractive({
      git: mockGit as never,
      files: [FILE_A],
      logger: makeLogger(),
      dirPath: FAKE_DIR,
    });

    const options: Array<{ value: string }> = mockSelect.mock.calls[0][0].options;
    expect(options.some((o) => o.value === 'chunk-by-chunk')).toBe(true);
  });
});
