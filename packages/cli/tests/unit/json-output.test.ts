import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printJson, printJsonError } from '../../src/json-output.js';

let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printJson', () => {
  it('writes a JSON success object to stdout', () => {
    printJson('status', { running: true });

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trimEnd());
    expect(output).toEqual({ ok: true, command: 'status', data: { running: true } });
  });

  it('output is newline-terminated', () => {
    printJson('init', {});

    const raw = writeSpy.mock.calls[0][0] as string;
    expect(raw.endsWith('\n')).toBe(true);
  });
});

describe('printJsonError', () => {
  it('writes a JSON error object and exits with code 1', () => {
    expect(() => printJsonError('init', 'something broke')).toThrow('process.exit(1)');

    const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trimEnd());
    expect(output).toEqual({
      ok: false,
      command: 'init',
      error: { message: 'something broke' },
    });
  });

  it('includes code field when provided', () => {
    expect(() => printJsonError('init', 'bad flags', 'INVALID_FLAGS')).toThrow('process.exit(1)');

    const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trimEnd());
    expect(output.error).toEqual({ message: 'bad flags', code: 'INVALID_FLAGS' });
  });

  it('omits code field when not provided', () => {
    expect(() => printJsonError('init', 'fail')).toThrow('process.exit(1)');

    const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trimEnd());
    expect(output.error).not.toHaveProperty('code');
  });
});
