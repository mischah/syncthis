import { describe, expect, it } from 'vitest';
import { parseLogLine } from '../../src/main/log-parser';

const ts = '2025-01-01T12:00:00.000Z';
const line = (level: string, msg: string) => `[${ts}] [${level}] ${msg}`;

describe('parseLogLine', () => {
  it('parses an INFO line', () => {
    expect(parseLogLine(line('INFO', ' sync started'))).toEqual({
      timestamp: ts,
      level: 'info',
      message: 'sync started',
      type: 'started',
    });
  });

  it('parses a WARN line', () => {
    const entry = parseLogLine(line('WARN', ' push failed: connection reset'));
    expect(entry?.level).toBe('warn');
    expect(entry?.type).toBe('push-failed');
  });

  it('parses an ERROR line', () => {
    const entry = parseLogLine(line('ERROR', 'unexpected failure'));
    expect(entry?.level).toBe('error');
    expect(entry?.type).toBe('error');
  });

  it('parses a DEBUG line', () => {
    const entry = parseLogLine(line('DEBUG', 'checking remote'));
    expect(entry?.level).toBe('debug');
    expect(entry?.type).toBe('other');
  });

  it('returns null for an empty string', () => {
    expect(parseLogLine('')).toBeNull();
  });

  it('returns null for a plain text line', () => {
    expect(parseLogLine('not a log line')).toBeNull();
  });

  it('returns null for an unknown log level', () => {
    expect(parseLogLine(`[${ts}] [TRACE] some trace`)).toBeNull();
  });

  describe('type categorization', () => {
    const cases: Array<[string, string, string]> = [
      ['INFO', ' sync started', 'started'],
      ['INFO', ' sync cycle: no changes', 'synced-no-changes'],
      ['INFO', ' sync cycle: pulled 3 commits', 'pulled'],
      ['INFO', ' sync cycle: 2 files changed, 1 insertion(+)', 'synced'],
      ['WARN', ' push failed: permission denied', 'push-failed'],
      ['INFO', ' conflict detected in file.md', 'conflict'],
      ['ERROR', 'unexpected error', 'error'],
      ['INFO', ' running health check', 'other'],
    ];

    for (const [level, msg, expectedType] of cases) {
      it(`"${msg.trim()}" → type "${expectedType}"`, () => {
        expect(parseLogLine(line(level, msg))?.type).toBe(expectedType);
      });
    }
  });
});
