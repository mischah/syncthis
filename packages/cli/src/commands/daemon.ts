import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, writeConfig } from '../config.js';
import {
  type DaemonConfig,
  type DaemonPlatform,
  getNodeBinary,
  getPlatform,
  getSyncthisBinary,
} from '../daemon/platform.js';
import { generateServiceName } from '../daemon/service-name.js';

export interface DaemonFlags {
  path: string;
  label?: string;
  enableAutostart?: boolean;
  cron?: string;
  interval?: number;
  logLevel?: string;
  follow?: boolean;
  lines?: number;
}

export async function handleDaemon(
  subcommand: string | undefined,
  flags: DaemonFlags,
): Promise<void> {
  switch (subcommand) {
    case 'start':
      await daemonStart(flags);
      break;
    case 'stop':
      await daemonStop(flags);
      break;
    case 'status':
      await daemonStatus(flags);
      break;
    case 'uninstall':
      await daemonUninstall(flags);
      break;
    case 'logs':
      await daemonLogs(flags);
      break;
    default: {
      const msg = subcommand
        ? `Unknown daemon subcommand '${subcommand}'.`
        : 'No daemon subcommand provided.';
      console.error(`Error: ${msg}`);
      console.error('Available subcommands: start, stop, status, uninstall, logs');
      process.exit(1);
    }
  }
}

async function resolveServiceName(flags: DaemonFlags): Promise<string> {
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

function getPlatformOrExit(): DaemonPlatform {
  try {
    return getPlatform();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return process.exit(1);
  }
}

async function daemonStart(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;

  const syncConfig = await loadConfig(dirPath).catch(() => {
    console.error("Error: Not initialized. Run 'syncthis init' first.");
    return process.exit(1);
  });

  const serviceName = generateServiceName(dirPath, flags.label);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'running') {
    const pidInfo = currentStatus.pid !== undefined ? ` (PID: ${currentStatus.pid})` : '';
    console.log(`Info: Daemon already running for ${dirPath}${pidInfo}.`);
    return;
  }

  const cron = flags.cron ?? syncConfig.cron ?? undefined;
  const interval = flags.interval ?? syncConfig.interval ?? undefined;

  const daemonConfig: DaemonConfig = {
    serviceName,
    dirPath,
    nodeExecutable: getNodeBinary(),
    syncthisBinary: getSyncthisBinary(),
    cron,
    interval,
    logLevel: flags.logLevel,
    autostart: flags.enableAutostart ?? false,
  };

  if (currentStatus.state === 'not-installed') {
    await platform.install(daemonConfig);
  }

  await platform.start(serviceName);

  if (!syncConfig.daemonLabel) {
    const labelPart = serviceName.replace('com.syncthis.', '');
    try {
      await writeConfig(dirPath, { ...syncConfig, daemonLabel: labelPart });
    } catch {
      // Non-fatal: config write failed
    }
  }

  if (flags.enableAutostart) {
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

async function daemonStop(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    console.error(`Error: No daemon found for ${dirPath}. Run 'syncthis daemon start' first.`);
    process.exit(1);
  }

  if (currentStatus.state === 'stopped') {
    console.log(`Info: Daemon is already stopped for ${dirPath}.`);
    return;
  }

  await platform.stop(serviceName);
  console.log(`Daemon stopped. Directory: ${dirPath}`);
}

async function daemonStatus(flags: DaemonFlags): Promise<void> {
  const platform = getPlatformOrExit();
  const pathExplicit = process.argv.some((arg) => arg === '--path' || arg.startsWith('--path='));

  if (flags.label !== undefined || pathExplicit) {
    const serviceName = await resolveServiceName(flags);
    const label = serviceName.replace('com.syncthis.', '');
    const serviceStatus = await platform.status(serviceName);

    let scheduleStr = 'unknown';
    try {
      const config = await loadConfig(flags.path);
      scheduleStr = config.cron ?? `every ${config.interval}s`;
    } catch {
      // Config not available
    }

    const statusStr =
      serviceStatus.state === 'running' && serviceStatus.pid !== undefined
        ? `running (PID ${serviceStatus.pid})`
        : serviceStatus.state;
    const logPath = join(flags.path, '.syncthis', 'logs', 'syncthis.log');

    console.log(`Daemon: ${label}`);
    console.log(`  Status:      ${statusStr}`);
    console.log(`  Path:        ${flags.path}`);
    console.log(`  Service:     ${serviceName}`);
    console.log(`  Schedule:    ${scheduleStr}`);
    console.log('  Autostart:   off');
    console.log(`  Log:         ${logPath}`);
  } else {
    const daemons = await platform.listAll();

    if (daemons.length === 0) {
      console.log('No syncthis daemons registered.');
      return;
    }

    console.log('syncthis daemons:\n');
    for (const d of daemons) {
      const icon = d.state === 'running' ? '●' : '○';
      const autostartStr = d.autostart ? 'on' : 'off';
      const pathStr = d.dirPath || '(unknown)';
      console.log(
        `  ${icon} ${d.label.padEnd(16)} ${d.state.padEnd(10)} ${pathStr.padEnd(30)} autostart: ${autostartStr}`,
      );
    }
  }
}

async function daemonUninstall(flags: DaemonFlags): Promise<void> {
  const dirPath = flags.path;
  const serviceName = await resolveServiceName(flags);
  const platform = getPlatformOrExit();
  const currentStatus = await platform.status(serviceName);

  if (currentStatus.state === 'not-installed') {
    console.log(`Info: No daemon installed for ${dirPath}. Nothing to uninstall.`);
    return;
  }

  await platform.uninstall(serviceName);

  try {
    const config = await loadConfig(dirPath);
    await writeConfig(dirPath, { ...config, daemonLabel: null });
  } catch {
    // Non-fatal
  }

  console.log(`Daemon uninstalled. Directory: ${dirPath}`);
}

async function daemonLogs(flags: DaemonFlags): Promise<void> {
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
