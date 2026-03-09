import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, mergeWithFlags, writeConfig } from '../config.js';
import {
  type DaemonConfig,
  type DaemonInfo,
  type DaemonPlatform,
  getNodeBinDir,
  getPlatform,
  getSyncthisBinary,
} from '../daemon/platform.js';
import { generateServiceName } from '../daemon/service-name.js';
import { isLocked, releaseLock } from '../lock.js';

export interface DaemonFlags {
  path: string;
  label?: string;
  enableAutostart?: boolean;
  cron?: string;
  interval?: number;
  onConflict?: string;
  logLevel?: string;
  follow?: boolean;
  lines?: number;
}

export async function resolveServiceName(flags: DaemonFlags): Promise<string> {
  if (flags.label !== undefined) {
    return generateServiceName(flags.path, flags.label);
  }
  try {
    const config = await loadConfig(flags.path);
    if (config.daemonLabel) {
      return generateServiceName(flags.path, config.daemonLabel);
    }
  } catch {
    // Config might not exist or be invalid
  }
  return generateServiceName(flags.path);
}

export function getPlatformOrExit(): DaemonPlatform {
  try {
    return getPlatform();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return process.exit(1);
  }
}

export async function daemonStart(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;

  const syncConfig = await loadConfig(dirPath).catch(() => {
    console.error("Error: Not initialized. Run 'syncthis init' first.");
    return process.exit(1);
  });

  const lockStatus = await isLocked(dirPath);
  if (lockStatus.locked) {
    console.log(`Info: Daemon already running for ${dirPath} (PID: ${lockStatus.pid}).`);
    return;
  }

  const serviceName = generateServiceName(
    dirPath,
    flags.label ?? syncConfig.daemonLabel ?? undefined,
  );
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'running') {
    const pidInfo = currentStatus.pid !== undefined ? ` (PID: ${currentStatus.pid})` : '';
    console.log(`Info: Daemon already running for ${dirPath}${pidInfo}.`);
    return;
  }

  const mergedConfig = mergeWithFlags(syncConfig, {
    cron: flags.cron,
    interval: flags.interval,
    onConflict: flags.onConflict as 'stop' | 'auto-both' | 'auto-newest' | undefined,
  });
  const autostart = flags.enableAutostart === true || (syncConfig.autostart ?? false);

  const daemonConfig: DaemonConfig = {
    serviceName,
    dirPath,
    nodeBinDir: getNodeBinDir(),
    syncthisBinary: getSyncthisBinary(),
    cron: mergedConfig.cron ?? undefined,
    interval: mergedConfig.interval ?? undefined,
    logLevel: flags.logLevel,
    onConflict: mergedConfig.onConflict !== 'auto-both' ? mergedConfig.onConflict : undefined,
    autostart,
  };

  await platform.install(daemonConfig);
  await platform.start(serviceName);

  const labelPart = serviceName.replace('com.syncthis.', '');
  try {
    const configToWrite = { ...mergedConfig, autostart };
    configToWrite.daemonLabel = labelPart;
    await writeConfig(dirPath, configToWrite);
  } catch {
    // Non-fatal: config write failed
  }

  if (autostart) {
    await platform.enableAutostart(serviceName);
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  const finalStatus = await platform.status(serviceName);

  if (finalStatus.state === 'running') {
    const pidInfo = finalStatus.pid !== undefined ? ` (PID: ${finalStatus.pid})` : '';
    console.log(`Daemon started${pidInfo}. Syncing: ${dirPath}`);
  } else {
    const logPath = join(dirPath, '.syncthis', 'logs', 'syncthis.log');
    const stderrLog = join(dirPath, '.syncthis', 'logs', 'launchd-stderr.log');
    let msg = `Warning: Daemon may not have started correctly.\n  Check logs: ${logPath}`;
    if (process.platform === 'darwin') {
      msg += `\n  System log: ${stderrLog}`;
      msg += '\n\n  Hint: macOS may have blocked the background activity.';
      msg += '\n  Approve it in: System Settings → General → Login Items → Allow in the Background';
    }
    console.warn(msg);
  }
}

export async function daemonStop(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    const lockStatus = await isLocked(dirPath);
    if (lockStatus.locked && lockStatus.pid !== undefined) {
      process.kill(lockStatus.pid, 'SIGTERM');
      await releaseLock(dirPath);
      console.log(`Foreground process stopped (PID: ${lockStatus.pid}). Directory: ${dirPath}`);
      return;
    }
    console.error(`Error: No service found for ${dirPath}. Run 'syncthis start' first.`);
    process.exit(1);
  }

  if (currentStatus.state === 'stopped') {
    console.log(`Info: Daemon is already stopped for ${dirPath}.`);
    return;
  }

  await platform.stop(serviceName);
  console.log(`Daemon stopped. Directory: ${dirPath}`);
}

export async function handleList(): Promise<void> {
  const platform = getPlatformOrExit();
  const daemons = await platform.listAll();

  if (daemons.length === 0) {
    console.log('No syncthis services registered.');
    return;
  }

  printDaemonTable(daemons);
}

export function printDaemonTable(daemons: DaemonInfo[]): void {
  const headers = ['Label', 'Status', 'PID', 'Schedule', 'Autostart', 'Path'];

  const rows = daemons.map((d) => [
    d.label,
    d.state,
    d.pid !== undefined ? String(d.pid) : '-',
    d.schedule || '-',
    d.autostart ? 'on' : 'off',
    d.dirPath || '(unknown)',
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const header = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(header);

  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
  }
}

export async function daemonUninstall(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    console.log(`Info: No service installed for ${dirPath}. Nothing to uninstall.`);
    return;
  }

  await platform.uninstall(serviceName);

  try {
    const config = await loadConfig(dirPath);
    await writeConfig(dirPath, { ...config, daemonLabel: null });
  } catch {
    // Non-fatal
  }

  console.log(`Service uninstalled. Directory: ${dirPath}`);
}

export async function daemonLogs(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;
  const logPath = join(dirPath, '.syncthis', 'logs', 'syncthis.log');

  if (flags.follow) {
    const child = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
    process.on('SIGINT', () => {
      child.kill();
      process.exit(0);
    });
    return;
  }

  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const n = flags.lines ?? 50;
    const lastLines = lines.slice(-n);
    if (lastLines.length === 0) {
      console.log('(log file is empty)');
    } else {
      console.log(lastLines.join('\n'));
    }
  } catch {
    console.error(`Error: No log file found at ${logPath}`);
    process.exit(1);
  }
}
