import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExeca = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));
vi.mock('execa', () => ({ execa: mockExeca }));

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

import { SystemdPlatform } from '../../src/daemon/systemd.js';

const BASE_CONFIG = {
  serviceName: 'com.syncthis.user-vault-notes',
  dirPath: '/home/user/vault-notes',
  syncthisBinary: '/usr/local/bin/syncthis',
  autostart: false,
};

const UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = join(UNIT_DIR, 'syncthis-user-vault-notes.service');
const UNIT_FILENAME = 'syncthis-user-vault-notes.service';

describe('SystemdPlatform', () => {
  let platform: SystemdPlatform;

  beforeEach(() => {
    platform = new SystemdPlatform();
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' });
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('install()', () => {
    it('writes the unit file to ~/.config/systemd/user/', async () => {
      await platform.install(BASE_CONFIG);
      expect(mockWriteFile).toHaveBeenCalledWith(
        UNIT_PATH,
        expect.stringContaining(
          'ExecStart=/usr/local/bin/syncthis start --path /home/user/vault-notes',
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
