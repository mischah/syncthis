import { describe, expect, it } from 'vitest';
import {
  formatTimestampForFilename,
  generateConflictFilename,
} from '../../src/conflict/conflict-filename.js';

const TS = new Date('2025-03-04T14:30:00.000Z');
const TS_STR = '2025-03-04T14-30-00';

describe('formatTimestampForFilename', () => {
  it('replaces colons with hyphens', () => {
    expect(formatTimestampForFilename(TS)).toBe(TS_STR);
  });

  it('removes milliseconds and trailing Z', () => {
    const result = formatTimestampForFilename(TS);
    expect(result).not.toMatch(/\.\d{3}/);
    expect(result).not.toMatch(/Z$/);
  });

  it('produces ISO-8601 format with T separator', () => {
    expect(formatTimestampForFilename(TS)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe('generateConflictFilename', () => {
  it('handles file with extension', () => {
    expect(generateConflictFilename('note.md', TS)).toBe(`note.conflict-${TS_STR}.md`);
  });

  it('handles file without extension', () => {
    expect(generateConflictFilename('Makefile', TS)).toBe(`Makefile.conflict-${TS_STR}`);
  });

  it('handles file with multiple dots (last dot is extension)', () => {
    expect(generateConflictFilename('data.backup.json', TS)).toBe(
      `data.backup.conflict-${TS_STR}.json`,
    );
  });

  it('handles hidden file without extension', () => {
    expect(generateConflictFilename('.env', TS)).toBe(`.env.conflict-${TS_STR}`);
  });

  it('preserves subdirectory path', () => {
    expect(generateConflictFilename('notes/sub/note.md', TS)).toBe(
      `notes/sub/note.conflict-${TS_STR}.md`,
    );
  });

  it('collision: appends counter when file already exists', () => {
    const existing = new Set([`note.conflict-${TS_STR}.md`]);
    const result = generateConflictFilename('note.md', TS, (p) => existing.has(p));
    expect(result).toBe(`note.conflict-${TS_STR}-1.md`);
  });

  it('collision: increments counter until a free name is found', () => {
    const existing = new Set([`note.conflict-${TS_STR}.md`, `note.conflict-${TS_STR}-1.md`]);
    const result = generateConflictFilename('note.md', TS, (p) => existing.has(p));
    expect(result).toBe(`note.conflict-${TS_STR}-2.md`);
  });

  it('collision: works for files without extension', () => {
    const existing = new Set([`Makefile.conflict-${TS_STR}`]);
    const result = generateConflictFilename('Makefile', TS, (p) => existing.has(p));
    expect(result).toBe(`Makefile.conflict-${TS_STR}-1`);
  });
});
