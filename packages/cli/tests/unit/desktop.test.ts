import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock node:util to pass through promisify but capture the execFile mock
vi.mock('node:util', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:util')>();
  return {
    ...original,
    promisify:
      (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) =>
        new Promise<void>((resolve, reject) => {
          fn(...args, (err: unknown) => {
            if (err) reject(err);
            else resolve();
          });
        }),
  };
});

import { execFile } from 'node:child_process';

const mockExecFile = vi.mocked(execFile);

// Re-import fresh module for each test to reset module-level cache
async function importDesktop() {
  // Clear the module cache so notifySendAvailable resets
  vi.resetModules();
  const mod = await import('../../src/notify/desktop.js');
  return mod.sendDesktopNotification;
}

describe('sendDesktopNotification', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    vi.resetModules();
  });

  describe('macOS', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
    });

    it('calls osascript with display notification command', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: null) => void)(null);
        return {} as ReturnType<typeof execFile>;
      });
      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'Push failed');
      expect(mockExecFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'display notification "Push failed" with title "syncthis"'],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        expect.any(Function),
      );
    });

    it('escapes double quotes in title and message', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: null) => void)(null);
        return {} as ReturnType<typeof execFile>;
      });
      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('say "hi"', 'path: "foo"');
      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args[1]).toContain('\\"hi\\"');
      expect(args[1]).toContain('\\"foo\\"');
    });

    it('does not throw when osascript fails', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: Error) => void)(new Error('osascript not found'));
        return {} as ReturnType<typeof execFile>;
      });
      const sendDesktopNotification = await importDesktop();
      await expect(sendDesktopNotification('syncthis', 'msg')).resolves.toBeUndefined();
    });

    it('passes AbortSignal with 5s timeout', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: null) => void)(null);
        return {} as ReturnType<typeof execFile>;
      });
      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'msg');
      const opts = mockExecFile.mock.calls[0][2] as { signal: AbortSignal };
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('Linux', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    });

    it('checks for notify-send availability then calls it', async () => {
      // First call: which notify-send → success
      // Second call: notify-send → success
      mockExecFile
        .mockImplementationOnce((_cmd, _args, _opts, cb) => {
          (cb as (err: null) => void)(null);
          return {} as ReturnType<typeof execFile>;
        })
        .mockImplementationOnce((_cmd, _args, _opts, cb) => {
          (cb as (err: null) => void)(null);
          return {} as ReturnType<typeof execFile>;
        });

      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'Conflict detected');

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile.mock.calls[0][0]).toBe('which');
      expect(mockExecFile.mock.calls[1][0]).toBe('notify-send');
      expect(mockExecFile.mock.calls[1][1]).toEqual(['syncthis', 'Conflict detected']);
    });

    it('caches notify-send availability — only checks once across multiple calls', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: null) => void)(null);
        return {} as ReturnType<typeof execFile>;
      });

      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'first');
      await sendDesktopNotification('syncthis', 'second');

      // which called once, notify-send called twice
      const whichCalls = mockExecFile.mock.calls.filter((c) => c[0] === 'which');
      const notifyCalls = mockExecFile.mock.calls.filter((c) => c[0] === 'notify-send');
      expect(whichCalls).toHaveLength(1);
      expect(notifyCalls).toHaveLength(2);
    });

    it('does not call notify-send when not available', async () => {
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (err: Error) => void)(new Error('not found'));
        return {} as ReturnType<typeof execFile>;
      });

      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'msg');

      expect(mockExecFile).toHaveBeenCalledTimes(1); // only which, no notify-send
    });

    it('does not throw when notify-send fails', async () => {
      mockExecFile
        .mockImplementationOnce((_cmd, _args, _opts, cb) => {
          (cb as (err: null) => void)(null);
          return {} as ReturnType<typeof execFile>;
        })
        .mockImplementationOnce((_cmd, _args, _opts, cb) => {
          (cb as (err: Error) => void)(new Error('dbus error'));
          return {} as ReturnType<typeof execFile>;
        });

      const sendDesktopNotification = await importDesktop();
      await expect(sendDesktopNotification('syncthis', 'msg')).resolves.toBeUndefined();
    });
  });

  describe('unsupported platform', () => {
    it('does not call execFile on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      const sendDesktopNotification = await importDesktop();
      await sendDesktopNotification('syncthis', 'msg');
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });
});
