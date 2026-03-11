import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger.js';

vi.mock('../../src/notify/desktop.js', () => ({
  sendDesktopNotification: vi.fn().mockResolvedValue(undefined),
}));

import { sendDesktopNotification } from '../../src/notify/desktop.js';
const mockSendDesktop = vi.mocked(sendDesktopNotification);

const ISO_RE = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe('createLogger – stdout output', () => {
  it('writes a formatted line to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'info', logDir: join(tempDir, '.syncthis/logs') });

    logger.info('hello world');

    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    expect(line).toMatch(ISO_RE);
    expect(line).toContain('[INFO]  hello world');
    expect(line.endsWith('\n')).toBe(true);
  });

  it('uses correct level tags and spacing for all four levels', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'debug', logDir: join(tempDir, '.syncthis/logs') });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    const lines = spy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toContain('[DEBUG] d');
    expect(lines[1]).toContain('[INFO]  i');
    expect(lines[2]).toContain('[WARN]  w');
    expect(lines[3]).toContain('[ERROR] e');
  });

  it('includes an ISO-8601 timestamp in every line', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'info', logDir: join(tempDir, '.syncthis/logs') });

    logger.info('ts check');

    const line = spy.mock.calls[0][0] as string;
    expect(line).toMatch(ISO_RE);
  });

  it('joins multiple arguments with a space', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'info', logDir: join(tempDir, '.syncthis/logs') });

    logger.info('a', 'b', 'c');

    const line = spy.mock.calls[0][0] as string;
    expect(line).toContain('a b c');
  });
});

describe('createLogger – file output', () => {
  it('writes the same line to the log file', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logDir = join(tempDir, '.syncthis/logs');
    const logger = createLogger({ level: 'info', logDir });

    logger.info('written to file');

    const content = readFileSync(join(logDir, 'syncthis.log'), 'utf8');
    expect(content).toContain('[INFO]  written to file');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('appends successive log lines to the same file', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logDir = join(tempDir, '.syncthis/logs');
    const logger = createLogger({ level: 'info', logDir });

    logger.info('first');
    logger.info('second');

    const lines = readFileSync(join(logDir, 'syncthis.log'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
  });

  it('creates the log directory automatically when it does not exist', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logDir = join(tempDir, 'deeply/nested/.syncthis/logs');
    const logger = createLogger({ level: 'info', logDir });

    logger.info('trigger dir creation');

    const content = readFileSync(join(logDir, 'syncthis.log'), 'utf8');
    expect(content).toContain('trigger dir creation');
  });
});

describe('createLogger – log-level filter', () => {
  it('suppresses debug at info level', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'info', logDir: join(tempDir, '.syncthis/logs') });

    logger.debug('should not appear');

    expect(spy).not.toHaveBeenCalled();
  });

  it('suppresses debug + info at warn level', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'warn', logDir: join(tempDir, '.syncthis/logs') });

    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes');

    expect(spy).toHaveBeenCalledTimes(2);
    const lines = spy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toContain('[WARN]');
    expect(lines[1]).toContain('[ERROR]');
  });

  it('suppresses everything below error at error level', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'error', logDir: join(tempDir, '.syncthis/logs') });

    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[ERROR]');
  });

  it('passes all levels at debug level', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger({ level: 'debug', logDir: join(tempDir, '.syncthis/logs') });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('filtered messages are also not written to the log file', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logDir = join(tempDir, '.syncthis/logs');
    const logger = createLogger({ level: 'warn', logDir });

    logger.debug('no');
    logger.info('no');

    // File should not exist because nothing was written
    expect(() => readFileSync(join(logDir, 'syncthis.log'), 'utf8')).toThrow();
  });
});

describe('createLogger – desktop notifications', () => {
  beforeEach(() => {
    mockSendDesktop.mockClear();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  it('calls sendDesktopNotification on warn when notify: true', () => {
    const logger = createLogger({
      level: 'info',
      logDir: join(tempDir, '.syncthis/logs'),
      notify: true,
    });
    logger.warn('push failed');
    expect(mockSendDesktop).toHaveBeenCalledWith('syncthis', 'push failed');
  });

  it('calls sendDesktopNotification on error when notify: true', () => {
    const logger = createLogger({
      level: 'info',
      logDir: join(tempDir, '.syncthis/logs'),
      notify: true,
    });
    logger.error('conflict detected');
    expect(mockSendDesktop).toHaveBeenCalledWith('syncthis', 'conflict detected');
  });

  it('does not call sendDesktopNotification on info when notify: true', () => {
    const logger = createLogger({
      level: 'info',
      logDir: join(tempDir, '.syncthis/logs'),
      notify: true,
    });
    logger.info('synced');
    expect(mockSendDesktop).not.toHaveBeenCalled();
  });

  it('does not call sendDesktopNotification on debug when notify: true', () => {
    const logger = createLogger({
      level: 'debug',
      logDir: join(tempDir, '.syncthis/logs'),
      notify: true,
    });
    logger.debug('no changes');
    expect(mockSendDesktop).not.toHaveBeenCalled();
  });

  it('does not call sendDesktopNotification when notify: false', () => {
    const logger = createLogger({
      level: 'info',
      logDir: join(tempDir, '.syncthis/logs'),
      notify: false,
    });
    logger.warn('push failed');
    logger.error('conflict');
    expect(mockSendDesktop).not.toHaveBeenCalled();
  });

  it('does not call sendDesktopNotification when notify is omitted (default false)', () => {
    const logger = createLogger({
      level: 'info',
      logDir: join(tempDir, '.syncthis/logs'),
    });
    logger.warn('push failed');
    logger.error('conflict');
    expect(mockSendDesktop).not.toHaveBeenCalled();
  });
});
