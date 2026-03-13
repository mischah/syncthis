import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
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
import {
  type BatchData,
  type DaemonStartData,
  type DaemonStopData,
  type DaemonUninstallData,
  printJson,
} from '../json-output.js';
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
  stale?: boolean;
  all?: boolean;
  json?: boolean;
}

export interface BatchResult {
  label: string;
  dirPath: string;
  outcome: 'ok' | 'skipped' | 'failed';
  message: string;
}

export function printBatchSummary(results: BatchResult[]): void {
  for (const r of results) {
    const icon = r.outcome === 'ok' ? '✓' : r.outcome === 'skipped' ? '-' : '✗';
    console.log(`  ${icon} ${r.label} (${r.dirPath}) — ${r.message}`);
  }
  const ok = results.filter((r) => r.outcome === 'ok').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok} succeeded`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  console.log(`\n${results.length} service${results.length === 1 ? '' : 's'}: ${parts.join(', ')}`);
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
  return getPlatform();
}

export async function daemonStart(flags: DaemonFlags): Promise<DaemonStartData> {
  const dirPath = flags.path;

  let syncConfig: Awaited<ReturnType<typeof loadConfig>>;
  try {
    syncConfig = await loadConfig(dirPath);
  } catch {
    throw new Error("Not initialized. Run 'syncthis init' first.");
  }

  const lockStatus = await isLocked(dirPath);
  if (lockStatus.locked) {
    return { dirPath, started: false, pid: lockStatus.pid, alreadyRunning: true };
  }

  const platform = getPlatformOrExit();

  // Resolve label: explicit flag > config > existing registered service for this dir > auto-generate
  let resolvedLabel = flags.label ?? syncConfig.daemonLabel ?? undefined;
  if (resolvedLabel === undefined) {
    try {
      const daemons = await platform.listAll();
      const existing = daemons.find((d) => d.dirPath === dirPath);
      if (existing) resolvedLabel = existing.label;
    } catch {
      // Non-fatal — fall through to auto-generation
    }
  }
  const serviceName = generateServiceName(dirPath, resolvedLabel);
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'running') {
    return { dirPath, started: false, pid: currentStatus.pid, alreadyRunning: true };
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
    return { dirPath, started: true, pid: finalStatus.pid };
  }

  const logPath = join(dirPath, '.syncthis', 'logs', 'syncthis.log');
  let warning = `Daemon may not have started correctly. Check logs: ${logPath}`;
  if (process.platform === 'darwin') {
    const stderrLog = join(dirPath, '.syncthis', 'logs', 'launchd-stderr.log');
    warning += ` | System log: ${stderrLog} | Hint: macOS may have blocked the background activity. Approve in: System Settings → General → Login Items → Allow in the Background`;
  }
  return { dirPath, started: false, warning };
}

export function printDaemonStartResult(result: DaemonStartData): void {
  if (result.alreadyRunning) {
    const pidInfo = result.pid !== undefined ? ` (PID: ${result.pid})` : '';
    console.log(`Info: Daemon already running for ${result.dirPath}${pidInfo}.`);
  } else if (result.started) {
    const pidInfo = result.pid !== undefined ? ` (PID: ${result.pid})` : '';
    console.log(`Daemon started${pidInfo}. Syncing: ${result.dirPath}`);
  } else if (result.warning !== undefined) {
    const logPath = join(result.dirPath, '.syncthis', 'logs', 'syncthis.log');
    let msg = `Warning: Daemon may not have started correctly.\n  Check logs: ${logPath}`;
    if (process.platform === 'darwin') {
      const stderrLog = join(result.dirPath, '.syncthis', 'logs', 'launchd-stderr.log');
      msg += `\n  System log: ${stderrLog}`;
      msg += '\n\n  Hint: macOS may have blocked the background activity.';
      msg += '\n  Approve it in: System Settings → General → Login Items → Allow in the Background';
    }
    console.warn(msg);
  }
}

export async function daemonStop(flags: DaemonFlags): Promise<void> {
  if (flags.all) {
    const platform = getPlatformOrExit();
    const daemons = await platform.listAll();
    if (daemons.length === 0) {
      if (flags.json) printJson('stop', { results: [] } satisfies BatchData);
      else console.log('No syncthis services registered.');
      return;
    }
    const results: BatchResult[] = [];
    for (const d of daemons) {
      if (d.state === 'stopped') {
        results.push({
          label: d.label,
          dirPath: d.dirPath,
          outcome: 'skipped',
          message: 'already stopped',
        });
        continue;
      }
      try {
        await platform.stop(d.serviceName);
        results.push({ label: d.label, dirPath: d.dirPath, outcome: 'ok', message: 'stopped' });
      } catch (err) {
        results.push({
          label: d.label,
          dirPath: d.dirPath,
          outcome: 'failed',
          message: (err as Error).message,
        });
      }
    }
    if (flags.json) {
      printJson('stop', { results } satisfies BatchData);
      if (results.some((r) => r.outcome === 'failed')) process.exit(1);
      return;
    }
    printBatchSummary(results);
    if (results.some((r) => r.outcome === 'failed')) process.exit(1);
    return;
  }

  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    const lockStatus = await isLocked(dirPath);
    if (lockStatus.locked && lockStatus.pid !== undefined) {
      process.kill(lockStatus.pid, 'SIGTERM');
      await releaseLock(dirPath);
      if (flags.json) {
        printJson('stop', {
          dirPath,
          stopped: true,
          pid: lockStatus.pid,
          foregroundStopped: true,
        } satisfies DaemonStopData);
        return;
      }
      console.log(`Foreground process stopped (PID: ${lockStatus.pid}). Directory: ${dirPath}`);
      return;
    }
    throw new Error(`No service found for ${dirPath}. Run 'syncthis start' first.`);
  }

  if (currentStatus.state === 'stopped') {
    if (flags.json) {
      printJson('stop', { dirPath, stopped: false, alreadyStopped: true } satisfies DaemonStopData);
      return;
    }
    console.log(`Info: Daemon is already stopped for ${dirPath}.`);
    return;
  }

  await platform.stop(serviceName);
  if (flags.json) {
    printJson('stop', { dirPath, stopped: true } satisfies DaemonStopData);
    return;
  }
  console.log(`Daemon stopped. Directory: ${dirPath}`);
}

export async function handleList(flags: { stale?: boolean; json?: boolean } = {}): Promise<void> {
  const platform = getPlatformOrExit();
  const daemons = flags.stale ? await findStaleServices(platform) : await platform.listAll();

  if (flags.json) {
    printJson('list', { services: daemons });
    return;
  }

  if (daemons.length === 0) {
    console.log(flags.stale ? 'No stale services found.' : 'No syncthis services registered.');
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

async function findStaleServices(platform: DaemonPlatform): Promise<DaemonInfo[]> {
  const all = await platform.listAll();
  const results: DaemonInfo[] = [];
  for (const service of all) {
    if (!service.dirPath) {
      results.push(service);
      continue;
    }
    try {
      await access(service.dirPath);
    } catch {
      results.push(service);
    }
  }
  return results;
}

export async function daemonUninstall(flags: DaemonFlags): Promise<void> {
  if (flags.all) {
    const platform = getPlatformOrExit();
    const daemons = await platform.listAll();
    if (daemons.length === 0) {
      if (flags.json) printJson('uninstall', { results: [] } satisfies BatchData);
      else console.log('No syncthis services registered.');
      return;
    }
    const results: BatchResult[] = [];
    for (const d of daemons) {
      try {
        await platform.uninstall(d.serviceName);
        try {
          const config = await loadConfig(d.dirPath);
          await writeConfig(d.dirPath, { ...config, daemonLabel: null });
        } catch {
          // Non-fatal
        }
        results.push({ label: d.label, dirPath: d.dirPath, outcome: 'ok', message: 'uninstalled' });
      } catch (err) {
        results.push({
          label: d.label,
          dirPath: d.dirPath,
          outcome: 'failed',
          message: (err as Error).message,
        });
      }
    }
    if (flags.json) {
      printJson('uninstall', { results } satisfies BatchData);
      if (results.some((r) => r.outcome === 'failed')) process.exit(1);
      return;
    }
    printBatchSummary(results);
    if (results.some((r) => r.outcome === 'failed')) process.exit(1);
    return;
  }

  if (flags.stale) {
    const platform = getPlatformOrExit();
    const stale = await findStaleServices(platform);
    if (stale.length === 0) {
      if (flags.json) printJson('uninstall', { results: [] } satisfies BatchData);
      else console.log('No stale services found.');
      return;
    }
    const results: BatchResult[] = [];
    for (const service of stale) {
      try {
        await platform.uninstall(service.serviceName);
        results.push({
          label: service.label,
          dirPath: service.dirPath,
          outcome: 'ok',
          message: 'uninstalled',
        });
        if (!flags.json)
          console.log(
            `Removed stale service: ${service.label} (${service.dirPath || 'unknown path'})`,
          );
      } catch (err) {
        results.push({
          label: service.label,
          dirPath: service.dirPath,
          outcome: 'failed',
          message: (err as Error).message,
        });
      }
    }
    if (flags.json) {
      printJson('uninstall', { results } satisfies BatchData);
      if (results.some((r) => r.outcome === 'failed')) process.exit(1);
    }
    return;
  }

  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    if (flags.json) {
      printJson('uninstall', {
        dirPath,
        uninstalled: false,
        notInstalled: true,
      } satisfies DaemonUninstallData);
      return;
    }
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

  if (flags.json) {
    printJson('uninstall', { dirPath, uninstalled: true } satisfies DaemonUninstallData);
    return;
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
