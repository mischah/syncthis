import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import {
  getContextLines,
  highlightWordDiff,
  parseUnifiedDiff,
  renderConflictDiff,
} from '../../src/conflict/diff-renderer.js';

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

describe('parseUnifiedDiff', () => {
  it('simple diff with one change → one hunk, correct lines', () => {
    const diff = createTwoFilesPatch(
      'file.txt',
      'file.txt',
      'hello\nworld\n',
      'hello\nearth\n',
      '',
      '',
      { context: 3 },
    );
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    const removed = hunk.lines.filter((l) => l.type === 'removed');
    const added = hunk.lines.filter((l) => l.type === 'added');
    const context = hunk.lines.filter((l) => l.type === 'context');
    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe('world');
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe('earth');
    expect(context.length).toBeGreaterThan(0);
  });

  it('diff with multiple hunks → array with correct structure', () => {
    const local = `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')}\n`;
    const remote = local.replace('line3', 'changed3').replace('line18', 'changed18');
    const diff = createTwoFilesPatch('f', 'f', local, remote, '', '', { context: 1 });
    const hunks = parseUnifiedDiff(diff);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    for (const h of hunks) {
      expect(h).toHaveProperty('oldStart');
      expect(h).toHaveProperty('newStart');
      expect(Array.isArray(h.lines)).toBe(true);
    }
  });

  it('identical files → empty array', () => {
    const content = 'same\ncontent\n';
    const diff = createTwoFilesPatch('f', 'f', content, content, '', '', { context: 3 });
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(0);
  });

  it('only added lines (new file) → one hunk, all added', () => {
    const diff = createTwoFilesPatch('f', 'f', '', 'line1\nline2\n', '', '', { context: 3 });
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    const types = hunks[0].lines.map((l) => l.type);
    expect(types.every((t) => t === 'added')).toBe(true);
  });

  it('only removed lines (deleted file) → one hunk, all removed', () => {
    const diff = createTwoFilesPatch('f', 'f', 'line1\nline2\n', '', '', '', { context: 3 });
    const hunks = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    const types = hunks[0].lines.map((l) => l.type);
    expect(types.every((t) => t === 'removed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getContextLines
// ---------------------------------------------------------------------------

describe('getContextLines', () => {
  it('10 lines → full', () => {
    expect(getContextLines(10)).toBe('full');
  });

  it('49 lines → full', () => {
    expect(getContextLines(49)).toBe('full');
  });

  it('50 lines → 5', () => {
    expect(getContextLines(50)).toBe(5);
  });

  it('500 lines → 5', () => {
    expect(getContextLines(500)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// renderConflictDiff
// ---------------------------------------------------------------------------

describe('renderConflictDiff', () => {
  const local = 'hello\nworld\nfoo\n';
  const remote = 'hello\nearth\nfoo\n';

  it('header contains file path', () => {
    const out = renderConflictDiff('notes/daily.md', local, remote);
    expect(out).toContain('notes/daily.md');
  });

  it('header contains Unicode line characters', () => {
    const out = renderConflictDiff('file.txt', local, remote);
    expect(out).toContain('─');
  });

  it('context lines are dimmed (ANSI sequences)', () => {
    const out = renderConflictDiff('file.txt', local, remote, { terminalWidth: 80 });
    // chalk.dim produces ESC[2m
    expect(out).toContain('\x1b[2m');
  });

  it('removed lines contain red ANSI sequences', () => {
    const out = renderConflictDiff('file.txt', local, remote, { terminalWidth: 80 });
    // Paired lines use bgRedBright (ESC[101m) for word-level highlighting
    expect(out).toContain('\x1b[101m');
  });

  it('added lines contain green ANSI sequences', () => {
    const out = renderConflictDiff('file.txt', local, remote, { terminalWidth: 80 });
    // Paired lines use bgGreenBright (ESC[102m) for word-level highlighting
    expect(out).toContain('\x1b[102m');
  });

  it('no +/- prefixes in output', () => {
    const out = renderConflictDiff('file.txt', local, remote, { terminalWidth: 80 });
    const lines = out.split('\n');
    // ESC char for stripping ANSI codes
    const ESC = '\x1b';
    const ansiPattern = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
    for (const line of lines) {
      // Strip ANSI codes and check there's no raw +/- at start (after trimming leading spaces)
      const stripped = line.replace(ansiPattern, '');
      // Lines with content should not start with + or - (the prefix chars)
      if (
        stripped.trim().length > 0 &&
        !stripped.trim().startsWith('@') &&
        !stripped.startsWith('─')
      ) {
        expect(stripped).not.toMatch(/^\s*[+-]/);
      }
    }
  });

  it('empty localContent shows "File is empty"', () => {
    const out = renderConflictDiff('file.txt', '', 'some content\n');
    expect(out).toContain('File is empty');
  });

  it('empty remoteContent shows "File is empty"', () => {
    const out = renderConflictDiff('file.txt', 'some content\n', '');
    expect(out).toContain('File is empty');
  });

  it('identical content shows "Files are identical"', () => {
    const out = renderConflictDiff('file.txt', 'same\n', 'same\n');
    expect(out).toContain('Files are identical');
  });

  it('binary content shows "Binary file"', () => {
    const binary = 'hello\0world';
    const out = renderConflictDiff('img.png', binary, 'other content');
    expect(out).toContain('Binary file');
  });

  it('terminal width is used for header line', () => {
    const out60 = renderConflictDiff('file.txt', local, remote, { terminalWidth: 60 });
    const out120 = renderConflictDiff('file.txt', local, remote, { terminalWidth: 120 });
    // First line is the header separator line
    const line60 = out60.split('\n')[0];
    const line120 = out120.split('\n')[0];
    expect(line60.length).toBe(60);
    expect(line120.length).toBe(120);
  });

  it('line pair with one changed word: output contains bgRedBright and bgGreenBright sequences', () => {
    const out = renderConflictDiff('file.txt', local, remote, { terminalWidth: 80 });
    // bgRedBright produces ESC[101m, bgGreenBright produces ESC[102m
    expect(out).toContain('\x1b[101m');
    expect(out).toContain('\x1b[102m');
  });

  it('multiple removed followed by multiple added: pairwise word-diff applied', () => {
    const multiLocal = 'hello world\ngoodbye moon\n';
    const multiRemote = 'hello earth\ngoodbye sun\n';
    const out = renderConflictDiff('file.txt', multiLocal, multiRemote, { terminalWidth: 80 });
    expect(out).toContain('\x1b[101m');
    expect(out).toContain('\x1b[102m');
  });

  it('unequal removed/added count: excess lines rendered without word-diff', () => {
    // 2 removed, 1 added → first pair word-diffed, second removed line plain red
    const unequalLocal = 'hello world\nextra line\n';
    const unequalRemote = 'hello earth\n';
    const out = renderConflictDiff('file.txt', unequalLocal, unequalRemote, { terminalWidth: 80 });
    // Word-level highlighting present for the pair
    expect(out).toContain('\x1b[101m');
    // "extra line" must appear in output (stripped of ANSI)
    const ESC = '\x1b';
    const ansiPattern = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
    const stripped = out.replace(ansiPattern, '');
    expect(stripped).toContain('extra line');
  });
});

// ---------------------------------------------------------------------------
// highlightWordDiff
// ---------------------------------------------------------------------------

describe('highlightWordDiff', () => {
  it('one word changed: changed word highlighted, unchanged part normal color', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('hello world', 'hello earth');
    expect(formattedOld).toContain('\x1b[101m'); // bgRedBright for "world"
    expect(formattedOld).toContain('\x1b[31m'); // red for "hello "
    expect(formattedNew).toContain('\x1b[102m'); // bgGreenBright for "earth"
    expect(formattedNew).toContain('\x1b[32m'); // green for "hello "
  });

  it('multiple words changed: all changed words highlighted', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('foo bar baz', 'foo qux baz');
    expect(formattedOld).toContain('\x1b[101m'); // bgRedBright for "bar"
    expect(formattedNew).toContain('\x1b[102m'); // bgGreenBright for "qux"
  });

  it('completely different lines: entire content highlighted', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('abc', 'xyz');
    expect(formattedOld).toContain('\x1b[101m'); // bgRedBright
    expect(formattedNew).toContain('\x1b[102m'); // bgGreenBright
  });

  it('identical lines: no word-level highlighting, only normal colors', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('same content', 'same content');
    expect(formattedOld).not.toContain('\x1b[101m'); // no bgRedBright
    expect(formattedNew).not.toContain('\x1b[102m'); // no bgGreenBright
    expect(formattedOld).toContain('\x1b[31m'); // normal red
    expect(formattedNew).toContain('\x1b[32m'); // normal green
  });

  it('empty old line: formattedOld is empty, new line highlighted', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('', 'new content');
    expect(formattedOld).toBe('');
    expect(formattedNew).toContain('\x1b[102m'); // bgGreenBright
  });

  it('empty new line: formattedNew is empty, old line highlighted', () => {
    const { formattedOld, formattedNew } = highlightWordDiff('old content', '');
    expect(formattedOld).toContain('\x1b[101m'); // bgRedBright
    expect(formattedNew).toBe('');
  });
});
