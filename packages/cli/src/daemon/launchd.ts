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
    try {
      await execa('launchctl', ['unload', plistPath]);
    } catch {
      // Not loaded yet — ignore
    }
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
    const lines = stdout.split('\n').filter((line) => line.includes('com.syncthis'));

    const results: DaemonInfo[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\t/);
      const pidStr = parts[0];
      const serviceName = parts[2] ?? '';
      const label = serviceName.replace('com.syncthis.', '');
      const pid = pidStr !== '-' ? Number.parseInt(pidStr, 10) : undefined;

      let dirPath = '';
      let autostart = false;
      let schedule = '';

      try {
        const content = await readFile(this.plistPath(serviceName), 'utf-8');
        dirPath = extractPlistValue(content, 'WorkingDirectory');
        autostart = extractPlistBoolean(content, 'RunAtLoad');
        schedule = extractScheduleFromArgs(content);
      } catch {
        // plist file not readable
      }

      results.push({
        serviceName,
        label,
        dirPath,
        state: pidStr !== '-' ? 'running' : 'stopped',
        pid,
        autostart,
        schedule,
      });
    }
    return results;
  }

  async enableAutostart(serviceName: string): Promise<void> {
    const plistPath = this.plistPath(serviceName);
    const content = await readFile(plistPath, 'utf-8');
    const modified = content.replace(/(<key>RunAtLoad<\/key>\s*)<false\/>/, '$1<true/>');
    await writeFile(plistPath, modified, 'utf-8');
  }

  async disableAutostart(serviceName: string): Promise<void> {
    const plistPath = this.plistPath(serviceName);
    const content = await readFile(plistPath, 'utf-8');
    const modified = content.replace(/(<key>RunAtLoad<\/key>\s*)<true\/>/, '$1<false/>');
    await writeFile(plistPath, modified, 'utf-8');
  }

  async isAutostartEnabled(serviceName: string): Promise<boolean> {
    try {
      const content = await readFile(this.plistPath(serviceName), 'utf-8');
      return extractPlistBoolean(content, 'RunAtLoad');
    } catch {
      return false;
    }
  }
}

function extractPlistValue(plist: string, key: string): string {
  const regex = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
  const match = plist.match(regex);
  return match?.[1] ?? '';
}

function extractPlistBoolean(plist: string, key: string): boolean {
  const regex = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`);
  const match = plist.match(regex);
  return match?.[1] === 'true';
}

function extractScheduleFromArgs(plist: string): string {
  const cronMatch = plist.match(/<string>--cron<\/string>\s*<string>([^<]*)<\/string>/);
  if (cronMatch) return cronMatch[1];

  const intervalMatch = plist.match(/<string>--interval<\/string>\s*<string>(\d+)<\/string>/);
  if (intervalMatch) return `every ${intervalMatch[1]}s`;

  return '';
}
