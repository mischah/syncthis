import { describe, expect, it } from 'vitest';
import { applyHunkDecisions } from '../../src/conflict/hunk-resolver.js';

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
