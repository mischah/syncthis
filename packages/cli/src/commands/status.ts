import { access } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { type SyncthisConfig, loadConfig } from '../config.js';
import { isRebaseInProgress } from '../conflict/resolver.js';
import { getPlatform } from '../daemon/platform.js';
import { generateServiceName } from '../daemon/service-name.js';
import { readHealthFile } from '../health.js';
import { type StatusData, printJson } from '../json-output.js';
import { isLocked, readLockFile } from '../lock.js';
import { printDaemonTable } from './daemon.js';

export interface StatusFlags {
  path: string;
  label?: string;
  all?: boolean;
  pathExplicit?: boolean;
  json?: boolean;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function handleStatus(flags: StatusFlags): Promise<void> {
  if (flags.all) {
    try {
      const platform = getPlatform();
      const daemons = await platform.listAll();
      if (flags.json) {
        printJson('status', { services: daemons });
        return;
      }
      if (daemons.length === 0) {
        console.log('No syncthis services registered.');
      } else {
        printDaemonTable(daemons);
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  const dirPath = flags.path;

  const configPath = join(dirPath, '.syncthis.json');
  if (!(await fileExists(configPath))) {
    if (flags.json) {
      printJson('status', {
        dirPath,
        initialized: false,
        health: null,
        config: null,
        syncProcess: { running: false },
        git: null,
        service: null,
      } satisfies StatusData);
      return;
    }
    if (!flags.pathExplicit) {
      console.log('No syncthis config found in current directory.');
      console.log("Run 'syncthis status --all' to see all services.");
    } else {
      console.log('Not initialized (no .syncthis.json found).');
      console.log('Run: syncthis init --remote <url>');
    }
    return;
  }

  // Accumulate data
  const data: StatusData = {
    dirPath,
    initialized: true,
    health: null,
    config: null,
    syncProcess: { running: false },
    git: null,
    service: null,
  };

  // Load config
  let config: SyncthisConfig | null = null;
  try {
    config = await loadConfig(dirPath);
    const schedule = config.cron ?? `${config.interval}s`;
    const logPath = join(dirPath, '.syncthis', 'logs', 'syncthis.log');
    data.config = {
      remote: config.remote,
      branch: config.branch,
      schedule,
      onConflict: config.onConflict,
      logPath,
    };
    if (!flags.json) {
      console.log('Config:');
      console.log(`  Remote:   ${config.remote}`);
      console.log(`  Branch:   ${config.branch}`);
      console.log(`  Schedule: ${schedule}`);
      console.log(`  On conflict: ${config.onConflict}`);
      console.log(`  Log:      ${logPath}`);
    }
  } catch (err) {
    if (!flags.json) console.log(`Config: invalid – ${(err as Error).message}`);
  }

  // Check running process via lock file
  const lockStatus = await isLocked(dirPath);
  if (lockStatus.locked) {
    const lockData = await readLockFile(dirPath);
    const runningSchedule =
      lockData?.schedule ??
      (config !== null ? (config.cron ?? `every ${config.interval}s`) : undefined);
    data.syncProcess = { running: true, pid: lockStatus.pid, schedule: runningSchedule };
    if (!flags.json) {
      console.log(`\nSync process: running (PID: ${lockStatus.pid})`);
      if (runningSchedule !== undefined) console.log(`  Schedule: ${runningSchedule}`);
    }
  } else {
    data.syncProcess = { running: false };
    if (!flags.json) console.log('\nSync process: not running');
  }

  // Git status
  if (!flags.json) console.log('\nGit:');
  try {
    const git = simpleGit(dirPath);

    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    const statusOutput = await git.raw(['status', '--porcelain']);
    const uncommittedCount = statusOutput.split('\n').filter(Boolean).length;
    const rebaseInProgress = await isRebaseInProgress(git);
    const logResult = await git.log({ maxCount: 1 });

    data.git = {
      branch: branch.trim(),
      remote: origin?.refs.fetch,
      uncommittedChanges: uncommittedCount,
      rebaseInProgress,
      lastCommit:
        logResult.latest !== null
          ? { date: logResult.latest.date, message: logResult.latest.message }
          : null,
    };

    if (!flags.json) {
      console.log(`  Branch:              ${branch.trim()}`);
      if (origin !== undefined) console.log(`  Remote:              ${origin.refs.fetch}`);
      console.log(`  Uncommitted changes: ${uncommittedCount}`);
      if (rebaseInProgress) {
        console.log('  Sync:                conflict (rebase in progress)');
        console.log(`  Run:                 syncthis resolve --path ${dirPath}`);
      }
      if (logResult.latest !== null) {
        console.log(
          `  Last commit:         ${logResult.latest.date} – ${logResult.latest.message}`,
        );
      } else {
        console.log('  Last commit:         (none)');
      }
    }
  } catch {
    if (!flags.json) console.log('  Not a git repository or git error.');
  }

  // Service status
  try {
    const platform = getPlatform();
    const label = flags.label ?? config?.daemonLabel;
    const serviceName = generateServiceName(dirPath, label ?? undefined);
    const serviceStatus = await platform.status(serviceName);

    if (serviceStatus.state === 'not-installed') {
      data.service = { state: 'not-installed' };
      if (!flags.json) console.log('\nService: not installed');
    } else {
      const autostart = await platform.isAutostartEnabled(serviceName);
      const serviceLabel = serviceName.replace('com.syncthis.', '');
      data.service = {
        state: serviceStatus.state,
        pid: serviceStatus.pid,
        label: serviceLabel,
        autostart,
      };
      if (!flags.json) {
        const statusStr =
          serviceStatus.state === 'running' && serviceStatus.pid !== undefined
            ? `running (PID ${serviceStatus.pid})`
            : serviceStatus.state;
        console.log('\nService:');
        console.log(`  Status:    ${statusStr}`);
        console.log(`  Label:     ${serviceLabel}`);
        console.log(`  Autostart: ${autostart ? 'on' : 'off'}`);
      }
    }
  } catch {
    // Platform not supported or other error — skip service section
  }

  // Health summary
  const healthFile = await readHealthFile(dirPath);
  if (healthFile !== null) {
    const lockStatus = await isLocked(dirPath);
    let healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (!lockStatus.locked) {
      healthStatus = 'unhealthy';
    } else if (healthFile.consecutiveFailures >= 5) {
      healthStatus = 'unhealthy';
    } else if (healthFile.consecutiveFailures > 0) {
      healthStatus = 'degraded';
    } else {
      healthStatus = 'healthy';
    }
    data.health = { status: healthStatus, lastSyncAt: healthFile.lastSyncAt };
    if (!flags.json) {
      const lastSync =
        healthFile.lastSyncAt !== null
          ? (() => {
              const ms = Date.now() - new Date(healthFile.lastSyncAt).getTime();
              const m = Math.floor(ms / 60000);
              return m < 1 ? 'just now' : `${m}m ago`;
            })()
          : 'never';
      console.log(`\nHealth: ${healthStatus} (last sync ${lastSync})`);
    }
  }

  if (flags.json) {
    printJson('status', data);
    return;
  }

  if (!flags.pathExplicit) {
    console.log("\nTip: Run 'syncthis status --all' to see all services.");
  }
}
