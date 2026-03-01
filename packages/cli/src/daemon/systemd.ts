import { readFile, unlink, writeFile } from 'node:fs/promises';
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

      const results: DaemonInfo[] = [];
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const unitFile = parts[0] ?? '';
        const activeState = parts[2] ?? '';
        const label = unitFile.replace('syncthis-', '').replace('.service', '');
        const serviceName = `com.syncthis.${label}`;
        const filename = this.unitFilename(serviceName);

        let dirPath = '';
        let schedule = '';
        let pid: number | undefined;

        try {
          const content = await readFile(this.unitPath(serviceName), 'utf-8');
          const wdMatch = content.match(/^WorkingDirectory=(.+)$/m);
          dirPath = wdMatch?.[1] ?? '';
          schedule = extractScheduleFromExecStart(content);
        } catch {
          // unit file not readable
        }

        if (activeState === 'active') {
          try {
            const { stdout: statusOut } = await execa('systemctl', ['--user', 'status', filename]);
            const pidMatch = statusOut.match(/Main PID:\s*(\d+)/);
            if (pidMatch) pid = Number.parseInt(pidMatch[1], 10);
          } catch {
            // status not available
          }
        }

        const autostart = await this.isAutostartEnabled(serviceName);

        results.push({
          serviceName,
          label,
          dirPath,
          state: activeState === 'active' ? 'running' : 'stopped',
          pid,
          autostart,
          schedule,
        });
      }
      return results;
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

  async isAutostartEnabled(serviceName: string): Promise<boolean> {
    const filename = this.unitFilename(serviceName);
    try {
      const { stdout } = await execa('systemctl', ['--user', 'is-enabled', filename]);
      return stdout.trim() === 'enabled';
    } catch {
      return false;
    }
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

function extractScheduleFromExecStart(unit: string): string {
  const execMatch = unit.match(/^ExecStart=(.+)$/m);
  if (!execMatch) return '';
  const execLine = execMatch[1];

  const cronMatch = execLine.match(/--cron\s+"?([^"]+)"?(?:\s|$)/);
  if (cronMatch) return cronMatch[1];

  const intervalMatch = execLine.match(/--interval\s+(\d+)/);
  if (intervalMatch) return `every ${intervalMatch[1]}s`;

  return '';
}
