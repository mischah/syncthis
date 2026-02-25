import { unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import type { DaemonConfig, DaemonInfo, DaemonPlatform, DaemonStatus } from './platform.js';
import { generateSystemdUnit } from './templates.js';

export class SystemdPlatform implements DaemonPlatform {
  private readonly unitDir = join(homedir(), '.config', 'systemd', 'user');

  private unitFilename(serviceName: string): string {
    const label = serviceName.replace('com.syncthis.', '');
    return `syncthis-${label}.service`;
  }

  private unitPath(serviceName: string): string {
    return join(this.unitDir, this.unitFilename(serviceName));
  }

  async install(config: DaemonConfig): Promise<void> {
    const unit = generateSystemdUnit(config);
    const unitPath = this.unitPath(config.serviceName);
    await writeFile(unitPath, unit, 'utf-8');
    await execa('systemctl', ['--user', 'daemon-reload']);
    await this.checkLinger();
  }

  async uninstall(serviceName: string): Promise<void> {
    const filename = this.unitFilename(serviceName);
    const unitPath = this.unitPath(serviceName);
    try {
      await execa('systemctl', ['--user', 'stop', filename]);
    } catch {
      // service may already be stopped
    }
    try {
      await execa('systemctl', ['--user', 'disable', filename]);
    } catch {
      // service may not be enabled
    }
    await unlink(unitPath);
    await execa('systemctl', ['--user', 'daemon-reload']);
  }

  async start(serviceName: string): Promise<void> {
    const filename = this.unitFilename(serviceName);
    await execa('systemctl', ['--user', 'start', filename]);
  }

  async stop(serviceName: string): Promise<void> {
    const filename = this.unitFilename(serviceName);
    await execa('systemctl', ['--user', 'stop', filename]);
  }

  async status(serviceName: string): Promise<DaemonStatus> {
    const filename = this.unitFilename(serviceName);
    try {
      const { stdout } = await execa('systemctl', ['--user', 'status', filename]);
      if (stdout.includes('Active: active (running)')) {
        const pidMatch = stdout.match(/Main PID:\s*(\d+)/);
        return {
          state: 'running',
          pid: pidMatch ? Number.parseInt(pidMatch[1], 10) : undefined,
        };
      }
      return { state: 'stopped' };
    } catch (err) {
      const error = err as { exitCode?: number };
      if (error.exitCode === 4) {
        return { state: 'not-installed' };
      }
      return { state: 'stopped' };
    }
  }

  async listAll(): Promise<DaemonInfo[]> {
    try {
      const { stdout } = await execa('systemctl', [
        '--user',
        'list-units',
        'syncthis-*',
        '--no-legend',
        '--no-pager',
      ]);
      if (!stdout.trim()) return [];
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          const unitFile = parts[0] ?? '';
          const activeState = parts[2] ?? '';
          const label = unitFile.replace('syncthis-', '').replace('.service', '');
          return {
            serviceName: `com.syncthis.${label}`,
            label,
            dirPath: '',
            state: activeState === 'active' ? ('running' as const) : ('stopped' as const),
            autostart: false,
          };
        });
    } catch {
      return [];
    }
  }

  async enableAutostart(serviceName: string): Promise<void> {
    const filename = this.unitFilename(serviceName);
    await execa('systemctl', ['--user', 'enable', filename]);
  }

  async disableAutostart(serviceName: string): Promise<void> {
    const filename = this.unitFilename(serviceName);
    await execa('systemctl', ['--user', 'disable', filename]);
  }

  async checkLinger(): Promise<boolean> {
    const user = process.env.USER ?? '';
    try {
      const { stdout } = await execa('loginctl', ['show-user', user, '--property=Linger']);
      const lingerEnabled = stdout.trim() === 'Linger=yes';
      if (!lingerEnabled) {
        console.warn(
          'WARN: User linger is not enabled. The daemon may stop when you log out.\n' +
            "      Run 'loginctl enable-linger $USER' to fix this (requires sudo).",
        );
      }
      return lingerEnabled;
    } catch {
      return false;
    }
  }
}
