import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExeca = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));
vi.mock('execa', () => ({ execa: mockExeca }));

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReadFile = vi.hoisted(() => vi.fn().mockResolvedValue(''));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
}));

import { LaunchdPlatform } from '../../src/daemon/launchd.js';

const BASE_CONFIG = {
  serviceName: 'com.syncthis.user-vault-notes',
  dirPath: '/home/user/vault-notes',
  nodeBinDir: '/usr/local/bin',
  syncthisBinary: '/usr/local/bin/syncthis',
};

const PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(PLIST_DIR, 'com.syncthis.user-vault-notes.plist');

const SAMPLE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>WorkingDirectory</key>
  <string>/home/user/vault-notes</string>
  <key>RunAtLoad</key>
  <true/>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/syncthis</string>
    <string>start</string>
    <string>--path</string>
    <string>/home/user/vault-notes</string>
    <string>--cron</string>
    <string>*/5 * * * *</string>
  </array>
</dict>
</plist>`;

describe('LaunchdPlatform', () => {
  let platform: LaunchdPlatform;

  beforeEach(() => {
    platform = new LaunchdPlatform();
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' });
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('');
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('install()', () => {
    it('writes the plist to ~/Library/LaunchAgents/', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockWriteFile).toHaveBeenCalledWith(
        PLIST_PATH,
        expect.stringContaining('<string>com.syncthis.user-vault-notes</string>'),
        'utf-8',
      );
    });

    it('tries to unload existing plist before writing', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockExeca).toHaveBeenCalledWith('launchctl', ['unload', PLIST_PATH]);
    });

    it('calls launchctl load with the plist path', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockExeca).toHaveBeenCalledWith('launchctl', ['load', PLIST_PATH]);
    });

    it('succeeds even if unload fails (not yet loaded)', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not loaded'));
      await platform.install(BASE_CONFIG);
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockExeca).toHaveBeenCalledWith('launchctl', ['load', PLIST_PATH]);
    });
  });

  describe('uninstall()', () => {
    it('calls launchctl unload with the plist path', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('launchctl', ['unload', PLIST_PATH]);
    });

    it('deletes the plist file', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockUnlink).toHaveBeenCalledWith(PLIST_PATH);
    });
  });

  describe('start()', () => {
    it('calls launchctl start with the service name', async () => {
      await platform.start('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('launchctl', [
        'start',
        'com.syncthis.user-vault-notes',
      ]);
    });
  });

  describe('stop()', () => {
    it('calls launchctl stop with the service name', async () => {
      await platform.stop('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('launchctl', [
        'stop',
        'com.syncthis.user-vault-notes',
      ]);
    });
  });

  describe('status()', () => {
    it('returns running state with PID when PID is present in output', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '{\n\t"PID" = 12345;\n\t"Label" = "com.syncthis.user-vault-notes";\n};',
      });
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'running', pid: 12345 });
    });

    it('returns stopped state when no PID in output', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: '{\n\t"Label" = "com.syncthis.user-vault-notes";\n};',
      });
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'stopped' });
    });

    it('returns not-installed state when launchctl throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('Could not find service'));
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'not-installed' });
    });
  });

  describe('enableAutostart()', () => {
    it('replaces RunAtLoad false with true in the plist without reloading', async () => {
      mockReadFile.mockResolvedValueOnce('<?xml version="1.0"?>\n<key>RunAtLoad</key>\n<false/>');
      await platform.enableAutostart('com.syncthis.user-vault-notes');
      expect(mockExeca).not.toHaveBeenCalledWith('launchctl', ['unload', PLIST_PATH]);
      expect(mockWriteFile).toHaveBeenCalledWith(
        PLIST_PATH,
        expect.stringContaining('<true/>'),
        'utf-8',
      );
      expect(mockExeca).not.toHaveBeenCalledWith('launchctl', ['load', PLIST_PATH]);
    });
  });

  describe('disableAutostart()', () => {
    it('replaces RunAtLoad true with false in the plist without reloading', async () => {
      mockReadFile.mockResolvedValueOnce('<?xml version="1.0"?>\n<key>RunAtLoad</key>\n<true/>');
      await platform.disableAutostart('com.syncthis.user-vault-notes');
      expect(mockExeca).not.toHaveBeenCalledWith('launchctl', ['unload', PLIST_PATH]);
      expect(mockWriteFile).toHaveBeenCalledWith(
        PLIST_PATH,
        expect.stringContaining('<false/>'),
        'utf-8',
      );
      expect(mockExeca).not.toHaveBeenCalledWith('launchctl', ['load', PLIST_PATH]);
    });
  });

  describe('isAutostartEnabled()', () => {
    it('returns true when RunAtLoad is true in the plist', async () => {
      mockReadFile.mockResolvedValueOnce(SAMPLE_PLIST);
      const result = await platform.isAutostartEnabled('com.syncthis.user-vault-notes');
      expect(result).toBe(true);
    });

    it('returns false when plist cannot be read', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await platform.isAutostartEnabled('com.syncthis.user-vault-notes');
      expect(result).toBe(false);
    });
  });

  describe('listAll()', () => {
    it('extracts dirPath, autostart, and schedule from plist files', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: [
          'PID\tStatus\tLabel',
          '12345\t0\tcom.syncthis.user-vault-notes',
          '-\t0\tcom.syncthis.work-notes',
          '9876\t0\tcom.apple.somethingelse',
        ].join('\n'),
      });
      // First plist read (user-vault-notes)
      mockReadFile.mockResolvedValueOnce(SAMPLE_PLIST);
      // Second plist read (work-notes) — no file
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await platform.listAll();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        serviceName: 'com.syncthis.user-vault-notes',
        state: 'running',
        pid: 12345,
        dirPath: '/home/user/vault-notes',
        autostart: true,
        schedule: '*/5 * * * *',
      });
      expect(result[1]).toMatchObject({
        serviceName: 'com.syncthis.work-notes',
        state: 'stopped',
        dirPath: '',
        autostart: false,
        schedule: '',
      });
    });
  });
});
