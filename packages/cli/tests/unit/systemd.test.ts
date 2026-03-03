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

import { SystemdPlatform } from '../../src/daemon/systemd.js';

const BASE_CONFIG = {
  serviceName: 'com.syncthis.user-vault-notes',
  dirPath: '/home/user/vault-notes',
  nodeBinDir: '/usr/local/bin',
  syncthisBinary: '/usr/local/bin/syncthis',
  autostart: false,
};

const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = join(UNIT_DIR, 'syncthis-user-vault-notes.service');
const UNIT_FILENAME = 'syncthis-user-vault-notes.service';

const SAMPLE_UNIT = `[Unit]
Description=syncthis sync daemon for /home/user/vault-notes

[Service]
Type=simple
ExecStart=/usr/local/bin/syncthis start --path /home/user/vault-notes --cron "*/5 * * * *"
WorkingDirectory=/home/user/vault-notes
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

describe('SystemdPlatform', () => {
  let platform: SystemdPlatform;

  beforeEach(() => {
    platform = new SystemdPlatform();
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' });
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('');
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('install()', () => {
    it('writes the unit file to ~/.config/systemd/user/', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockWriteFile).toHaveBeenCalledWith(
        UNIT_PATH,
        expect.stringContaining(
          'ExecStart=/usr/local/bin/syncthis start --foreground --path /home/user/vault-notes',
        ),
        'utf-8',
      );
    });

    it('calls systemctl --user daemon-reload after writing the unit', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload']);
    });
  });

  describe('uninstall()', () => {
    it('stops the service', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'stop', UNIT_FILENAME]);
    });

    it('disables the service', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'disable', UNIT_FILENAME]);
    });

    it('deletes the unit file', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockUnlink).toHaveBeenCalledWith(UNIT_PATH);
    });

    it('calls daemon-reload after deleting the unit', async () => {
      await platform.uninstall('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload']);
    });
  });

  describe('start()', () => {
    it('calls systemctl --user start with the unit filename', async () => {
      await platform.start('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'start', UNIT_FILENAME]);
    });
  });

  describe('stop()', () => {
    it('calls systemctl --user stop with the unit filename', async () => {
      await platform.stop('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'stop', UNIT_FILENAME]);
    });
  });

  describe('status()', () => {
    it('returns running state with PID when service is active', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout:
          '● syncthis-user-vault-notes.service\n   Active: active (running)\n   Main PID: 12345 (syncthis)',
      });
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'running', pid: 12345 });
    });

    it('returns stopped state when service is inactive', async () => {
      const err = Object.assign(new Error('exit code 3'), { exitCode: 3 });
      mockExeca.mockRejectedValueOnce(err);
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'stopped' });
    });

    it('returns not-installed state when unit is not found (exit code 4)', async () => {
      const err = Object.assign(new Error('exit code 4'), { exitCode: 4 });
      mockExeca.mockRejectedValueOnce(err);
      const result = await platform.status('com.syncthis.user-vault-notes');
      expect(result).toEqual({ state: 'not-installed' });
    });
  });

  describe('listAll()', () => {
    it('extracts dirPath, schedule, and autostart from unit files', async () => {
      // list-units call
      mockExeca.mockResolvedValueOnce({
        stdout: 'syncthis-vault.service loaded active running syncthis vault',
      });
      // unit file read
      mockReadFile.mockResolvedValueOnce(SAMPLE_UNIT);
      // systemctl status for PID
      mockExeca.mockResolvedValueOnce({
        stdout: 'Active: active (running)\n   Main PID: 5678 (node)',
      });
      // is-enabled check
      mockExeca.mockResolvedValueOnce({ stdout: 'enabled' });

      const result = await platform.listAll();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        serviceName: 'com.syncthis.vault',
        label: 'vault',
        state: 'running',
        pid: 5678,
        dirPath: '/home/user/vault-notes',
        autostart: true,
        schedule: '*/5 * * * *',
      });
    });

    it('returns empty array when output is empty', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: '' });
      const result = await platform.listAll();
      expect(result).toEqual([]);
    });

    it('returns empty array when systemctl throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('systemctl not found'));
      const result = await platform.listAll();
      expect(result).toEqual([]);
    });
  });

  describe('enableAutostart()', () => {
    it('calls systemctl --user enable with the unit filename', async () => {
      await platform.enableAutostart('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'enable', UNIT_FILENAME]);
    });
  });

  describe('disableAutostart()', () => {
    it('calls systemctl --user disable with the unit filename', async () => {
      await platform.disableAutostart('com.syncthis.user-vault-notes');
      expect(mockExeca).toHaveBeenCalledWith('systemctl', ['--user', 'disable', UNIT_FILENAME]);
    });
  });

  describe('isAutostartEnabled()', () => {
    it('returns true when systemctl is-enabled returns enabled', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'enabled' });
      const result = await platform.isAutostartEnabled('com.syncthis.user-vault-notes');
      expect(result).toBe(true);
    });

    it('returns false when systemctl is-enabled returns disabled', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'disabled' });
      const result = await platform.isAutostartEnabled('com.syncthis.user-vault-notes');
      expect(result).toBe(false);
    });

    it('returns false when systemctl is-enabled throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not found'));
      const result = await platform.isAutostartEnabled('com.syncthis.user-vault-notes');
      expect(result).toBe(false);
    });
  });

  describe('checkLinger()', () => {
    it('returns true when linger is enabled', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'Linger=yes' });
      const result = await platform.checkLinger();
      expect(result).toBe(true);
    });

    it('returns false and warns when linger is not enabled', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'Linger=no' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await platform.checkLinger();
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('linger'));
      warnSpy.mockRestore();
    });

    it('calls loginctl with the USER env variable', async () => {
      const originalUser = process.env.USER;
      process.env.USER = 'testuser';
      mockExeca.mockResolvedValueOnce({ stdout: 'Linger=yes' });
      await platform.checkLinger();
      expect(mockExeca).toHaveBeenCalledWith('loginctl', [
        'show-user',
        'testuser',
        '--property=Linger',
      ]);
      process.env.USER = originalUser;
    });
  });
});
