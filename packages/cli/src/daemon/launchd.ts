import { readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import type { DaemonConfig, DaemonInfo, DaemonPlatform, DaemonStatus } from './platform.js';
import { generatePlist } from './templates.js';

export class LaunchdPlatform implements DaemonPlatform {
  private readonly plistDir = join(homedir(), 'Library', 'LaunchAgents');

  private plistPath(serviceName: string): string {
    return join(this.plistDir, `${serviceName}.plist`);
  }

  async install(config: DaemonConfig): Promise<void> {
    const plist = generatePlist(config);
    const plistPath = this.plistPath(config.serviceName);
    await writeFile(plistPath, plist, 'utf-8');
    await execa('launchctl', ['load', plistPath]);
  }

  async uninstall(serviceName: string): Promise<void> {
    const plistPath = this.plistPath(serviceName);
    await execa('launchctl', ['unload', plistPath]);
    await unlink(plistPath);
  }

  async start(serviceName: string): Promise<void> {
    await execa('launchctl', ['start', serviceName]);
  }

  async stop(serviceName: string): Promise<void> {
    await execa('launchctl', ['stop', serviceName]);
  }

  async status(serviceName: string): Promise<DaemonStatus> {
    try {
      const { stdout } = await execa('launchctl', ['list', serviceName]);
      const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/);
      if (pidMatch) {
        return { state: 'running', pid: Number.parseInt(pidMatch[1], 10) };
      }
      return { state: 'stopped' };
    } catch {
      return { state: 'not-installed' };
    }
  }

  async listAll(): Promise<DaemonInfo[]> {
    const { stdout } = await execa('launchctl', ['list']);
    return stdout
      .split('\n')
      .filter((line) => line.includes('com.syncthis'))
      .map((line) => {
        const parts = line.trim().split(/\t/);
        const pid = parts[0];
        const serviceName = parts[2] ?? '';
        const label = serviceName.replace('com.syncthis.', '');
        return {
          serviceName,
          label,
          dirPath: '',
          state: pid !== '-' ? ('running' as const) : ('stopped' as const),
          autostart: false,
        };
      });
  }

  async enableAutostart(serviceName: string): Promise<void> {
    const plistPath = this.plistPath(serviceName);
    await execa('launchctl', ['unload', plistPath]);
    const content = await readFile(plistPath, 'utf-8');
    const modified = content.replace(/(<key>RunAtLoad<\/key>\s*)<false\/>/, '$1<true/>');
    await writeFile(plistPath, modified, 'utf-8');
    await execa('launchctl', ['load', plistPath]);
  }

  async disableAutostart(serviceName: string): Promise<void> {
    const plistPath = this.plistPath(serviceName);
    await execa('launchctl', ['unload', plistPath]);
    const content = await readFile(plistPath, 'utf-8');
    const modified = content.replace(/(<key>RunAtLoad<\/key>\s*)<true\/>/, '$1<false/>');
    await writeFile(plistPath, modified, 'utf-8');
    await execa('launchctl', ['load', plistPath]);
  }
}
