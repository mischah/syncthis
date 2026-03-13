import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for resolveChunkByChunk
// ---------------------------------------------------------------------------

const mockSelect = vi.hoisted(() => vi.fn());
const mockIsCancel = vi.hoisted(() => vi.fn(() => false));
const mockLogStep = vi.hoisted(() => vi.fn());
vi.mock('@clack/prompts', () => ({
  select: mockSelect,
  isCancel: mockIsCancel,
  log: { step: mockLogStep },
}));

vi.mock('../../src/conflict/diff-renderer.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    clearScreen: vi.fn(),
    renderSingleHunk: vi.fn(() => '(hunk output)'),
    renderStatusLine: vi.fn(() => '(status)'),
  };
});

import {
  applyHunkDecisions,
  getHunkCount,
  resolveChunkByChunk,
} from '../../src/conflict/hunk-resolver.js';

const local = 'line1\nline2\nline3\nline4\nline5\n';
const remote = 'line1\nCHANGED2\nline3\nCHANGED4\nline5\n';

describe('applyHunkDecisions', () => {
  it('all local → returns original content', () => {
    const result = applyHunkDecisions(local, remote, ['local', 'local']);
    expect(result).toBe(local);
  });

  it('all remote → returns remote content', () => {
    const result = applyHunkDecisions(local, remote, ['remote', 'remote']);
    expect(result).toBe(remote);
  });

  it('mixed: first local, second remote', () => {
    const result = applyHunkDecisions(local, remote, ['local', 'remote']);
    expect(result).toBe('line1\nline2\nline3\nCHANGED4\nline5\n');
  });

  it('mixed: first remote, second local', () => {
    const result = applyHunkDecisions(local, remote, ['remote', 'local']);
    expect(result).toBe('line1\nCHANGED2\nline3\nline4\nline5\n');
  });

  it('both → local lines followed by added lines', () => {
    const result = applyHunkDecisions(local, remote, ['both', 'local']);
    expect(result).toContain('line2');
    expect(result).toContain('CHANGED2');
  });

  it('single hunk file', () => {
    const l = 'hello\n';
    const r = 'world\n';
    expect(applyHunkDecisions(l, r, ['remote'])).toBe('world\n');
    expect(applyHunkDecisions(l, r, ['local'])).toBe('hello\n');
  });

  it('identical files → returns original (no hunks)', () => {
    expect(applyHunkDecisions(local, local, [])).toBe(local);
  });

  it('file without trailing newline: round-trips correctly', () => {
    const l = 'hello';
    const r = 'world';
    expect(applyHunkDecisions(l, r, ['local'])).toBe('hello');
    expect(applyHunkDecisions(l, r, ['remote'])).toBe('world');
  });

  it('added-only lines appended for both decision', () => {
    const l = 'a\nb\nc\n';
    const r = 'a\nX\nc\n';
    // 'both' keeps local 'b' and appends remote addition 'X'
    const result = applyHunkDecisions(l, r, ['both']);
    expect(result).toContain('b');
    expect(result).toContain('X');
  });
});

// ---------------------------------------------------------------------------
// getHunkCount
// ---------------------------------------------------------------------------

describe('getHunkCount', () => {
  it('returns 0 for identical content', () => {
    expect(getHunkCount(local, local)).toBe(0);
  });

  it('counts independent change regions', () => {
    expect(getHunkCount(local, remote)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolveChunkByChunk
// ---------------------------------------------------------------------------

describe('resolveChunkByChunk', () => {
  const progress = { index: 0, total: 1, resolved: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns resolved with original content when files are identical', async () => {
    const result = await resolveChunkByChunk(local, local, 'file.txt', progress);

    expect(result).toEqual({ status: 'resolved', mergedContent: local });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns back when user cancels', async () => {
    mockSelect.mockResolvedValueOnce(Symbol('cancel'));
    mockIsCancel.mockReturnValueOnce(true);

    const result = await resolveChunkByChunk(local, remote, 'file.txt', progress);

    expect(result).toEqual({ status: 'back' });
  });

  it('returns back when user selects back', async () => {
    mockSelect.mockResolvedValueOnce('back');

    const result = await resolveChunkByChunk(local, remote, 'file.txt', progress);

    expect(result).toEqual({ status: 'back' });
  });

  it('resolves all hunks and returns merged content', async () => {
    // Two hunks in local vs remote, choose 'remote' for both
    mockSelect.mockResolvedValueOnce('remote').mockResolvedValueOnce('remote');

    const result = await resolveChunkByChunk(local, remote, 'file.txt', progress);

    expect(result.status).toBe('resolved');
    expect(result.mergedContent).toBe(remote);
  });

  it('applies mixed decisions correctly', async () => {
    mockSelect.mockResolvedValueOnce('local').mockResolvedValueOnce('remote');

    const result = await resolveChunkByChunk(local, remote, 'file.txt', progress);

    expect(result.status).toBe('resolved');
    expect(result.mergedContent).toBe('line1\nline2\nline3\nCHANGED4\nline5\n');
  });
});
