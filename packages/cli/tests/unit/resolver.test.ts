import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConflictFiles, resolveFile, resolveRebase } from '../../src/conflict/resolver.js';
import type { Logger } from '../../src/logger.js';

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
}));

const mockGit = vi.hoisted(() => ({
  raw: vi.fn(),
  add: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}));

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const FAKE_DIR = '/fake/repo';
const TS = new Date('2025-03-04T14:30:00.000Z');
const TS_STR = '2025-03-04T14-30-00';

beforeEach(() => {
  vi.clearAllMocks();
  mockGit.add.mockResolvedValue(undefined);
  mockGit.raw.mockResolvedValue('');
  mockWriteFile.mockResolvedValue(undefined);
});

describe('getConflictFiles', () => {
  it('parses a single conflict file', async () => {
    mockGit.raw.mockResolvedValueOnce('notes/daily.md\n');
    const files = await getConflictFiles(mockGit as never);
    expect(files).toEqual([{ filePath: 'notes/daily.md' }]);
    expect(mockGit.raw).toHaveBeenCalledWith(['diff', '--name-only', '--diff-filter=U']);
  });

  it('parses multiple conflict files', async () => {
    mockGit.raw.mockResolvedValueOnce('notes/daily.md\nnotes/todo.md\n');
    const files = await getConflictFiles(mockGit as never);
    expect(files).toEqual([{ filePath: 'notes/daily.md' }, { filePath: 'notes/todo.md' }]);
  });

  it('returns empty array when no conflict files', async () => {
    mockGit.raw.mockResolvedValueOnce('');
    const files = await getConflictFiles(mockGit as never);
    expect(files).toEqual([]);
  });
});

describe('resolveFile – auto-both', () => {
  it('calls git show REBASE_HEAD:<file>', async () => {
    mockGit.raw
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined); // git checkout --ours

    await resolveFile(mockGit as never, { filePath: 'note.md' }, 'auto-both', TS, FAKE_DIR);

    expect(mockGit.raw).toHaveBeenCalledWith(['show', 'REBASE_HEAD:note.md']);
  });

  it('writes the conflict copy with correct filename and content', async () => {
    mockGit.raw
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined); // git checkout --ours

    await resolveFile(mockGit as never, { filePath: 'note.md' }, 'auto-both', TS, FAKE_DIR);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${FAKE_DIR}/note.conflict-${TS_STR}.md`,
      'remote content',
      'utf8',
    );
  });

  it('calls git checkout --ours', async () => {
    mockGit.raw
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined); // git checkout --ours

    await resolveFile(mockGit as never, { filePath: 'note.md' }, 'auto-both', TS, FAKE_DIR);

    expect(mockGit.raw).toHaveBeenCalledWith(['checkout', '--ours', 'note.md']);
  });

  it('stages both the original file and the conflict copy', async () => {
    mockGit.raw
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined); // git checkout --ours

    await resolveFile(mockGit as never, { filePath: 'note.md' }, 'auto-both', TS, FAKE_DIR);

    expect(mockGit.add).toHaveBeenCalledWith(['note.md', `note.conflict-${TS_STR}.md`]);
  });

  it('returns { action: "both", conflictCopy }', async () => {
    mockGit.raw
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined); // git checkout --ours

    const result = await resolveFile(
      mockGit as never,
      { filePath: 'note.md' },
      'auto-both',
      TS,
      FAKE_DIR,
    );

    expect(result.action).toBe('both');
    expect(result.conflictCopy).toBe(`note.conflict-${TS_STR}.md`);
  });
});

describe('resolveFile – auto-newest', () => {
  it('local newer: fetches both timestamps, calls checkout --ours, returns { action: "ours" }', async () => {
    mockGit.raw
      .mockResolvedValueOnce('2025-03-04T14:30:00+00:00\n') // local timestamp
      .mockResolvedValueOnce('2025-03-03T09:15:00+00:00\n') // remote timestamp
      .mockResolvedValueOnce(undefined); // checkout --ours

    const result = await resolveFile(
      mockGit as never,
      { filePath: 'note.md' },
      'auto-newest',
      TS,
      FAKE_DIR,
    );

    expect(mockGit.raw).toHaveBeenCalledWith(['log', '-1', '--format=%aI', '--', 'note.md']);
    expect(mockGit.raw).toHaveBeenCalledWith([
      'log',
      '-1',
      '--format=%aI',
      'REBASE_HEAD',
      '--',
      'note.md',
    ]);
    expect(mockGit.raw).toHaveBeenCalledWith(['checkout', '--ours', 'note.md']);
    expect(result.action).toBe('ours');
    expect(result.conflictCopy).toBeUndefined();
  });

  it('remote newer: calls checkout --theirs, returns { action: "theirs" }', async () => {
    mockGit.raw
      .mockResolvedValueOnce('2025-03-03T09:15:00+00:00\n') // local timestamp
      .mockResolvedValueOnce('2025-03-04T14:30:00+00:00\n') // remote timestamp
      .mockResolvedValueOnce(undefined); // checkout --theirs

    const result = await resolveFile(
      mockGit as never,
      { filePath: 'note.md' },
      'auto-newest',
      TS,
      FAKE_DIR,
    );

    expect(mockGit.raw).toHaveBeenCalledWith(['checkout', '--theirs', 'note.md']);
    expect(result.action).toBe('theirs');
    expect(result.conflictCopy).toBeUndefined();
  });

  it('equal timestamps: falls back to auto-both, returns { action: "both", conflictCopy }', async () => {
    mockGit.raw
      .mockResolvedValueOnce('2025-03-04T14:30:00+00:00\n') // local timestamp
      .mockResolvedValueOnce('2025-03-04T14:30:00+00:00\n') // remote timestamp
      .mockResolvedValueOnce('remote content') // git show (auto-both fallback)
      .mockResolvedValueOnce(undefined); // checkout --ours

    const result = await resolveFile(
      mockGit as never,
      { filePath: 'note.md' },
      'auto-newest',
      TS,
      FAKE_DIR,
    );

    expect(result.action).toBe('both');
    expect(result.conflictCopy).toBe(`note.conflict-${TS_STR}.md`);
  });
});

describe('resolveRebase', () => {
  it('one step, one conflict → status resolved', async () => {
    const logger = makeLogger();
    mockGit.raw
      .mockResolvedValueOnce('note.md\n') // getConflictFiles
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined) // checkout --ours
      .mockResolvedValueOnce(undefined) // rebase --continue
      .mockResolvedValueOnce(''); // getConflictFiles → no more conflicts

    const result = await resolveRebase(mockGit as never, 'auto-both', FAKE_DIR, logger);

    expect(result.status).toBe('resolved');
    expect(result.resolvedFiles).toEqual(['note.md']);
    expect(result.conflictCopies).toHaveLength(1);
    expect(result.rebaseSteps).toBe(1);
  });

  it('multiple rebase steps → all resolved', async () => {
    const logger = makeLogger();
    mockGit.raw
      // Step 1
      .mockResolvedValueOnce('note.md\n') // getConflictFiles
      .mockResolvedValueOnce('content 1') // git show
      .mockResolvedValueOnce(undefined) // checkout --ours
      .mockResolvedValueOnce(undefined) // rebase --continue
      // Step 2
      .mockResolvedValueOnce('todo.md\n') // getConflictFiles
      .mockResolvedValueOnce('content 2') // git show
      .mockResolvedValueOnce(undefined) // checkout --ours
      .mockResolvedValueOnce(undefined) // rebase --continue
      // Done
      .mockResolvedValueOnce(''); // getConflictFiles → no more conflicts

    const result = await resolveRebase(mockGit as never, 'auto-both', FAKE_DIR, logger);

    expect(result.status).toBe('resolved');
    expect(result.resolvedFiles).toEqual(['note.md', 'todo.md']);
    expect(result.rebaseSteps).toBe(2);
  });

  it('limit reached → calls git rebase --abort, returns status "aborted"', async () => {
    const logger = makeLogger();
    const maxSteps = 2;

    // 3 iterations of conflicts (steps 1, 2, 3 — step 3 exceeds limit of 2)
    for (let i = 0; i < maxSteps + 1; i++) {
      mockGit.raw
        .mockResolvedValueOnce('note.md\n') // getConflictFiles
        .mockResolvedValueOnce('remote content') // git show
        .mockResolvedValueOnce(undefined) // checkout --ours
        .mockResolvedValueOnce(undefined); // rebase --continue
    }
    mockGit.raw.mockResolvedValueOnce(undefined); // rebase --abort

    const result = await resolveRebase(mockGit as never, 'auto-both', FAKE_DIR, logger, maxSteps);

    expect(result.status).toBe('aborted');
    expect(mockGit.raw).toHaveBeenCalledWith(['rebase', '--abort']);
    expect(result.rebaseSteps).toBe(maxSteps + 1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Too many consecutive'));
  });

  it('no conflict after rebase --continue → immediately resolved on next iteration', async () => {
    const logger = makeLogger();
    mockGit.raw
      .mockResolvedValueOnce('note.md\n') // getConflictFiles → has conflict
      .mockResolvedValueOnce('remote content') // git show
      .mockResolvedValueOnce(undefined) // checkout --ours
      .mockResolvedValueOnce(undefined) // rebase --continue → succeeds
      .mockResolvedValueOnce(''); // getConflictFiles → no more conflicts

    const result = await resolveRebase(mockGit as never, 'auto-both', FAKE_DIR, logger);

    expect(result.status).toBe('resolved');
    expect(result.rebaseSteps).toBe(1);
  });
});
