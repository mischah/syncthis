import { access } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { type SyncthisConfig, loadConfig } from '../config.js';
import { isRebaseInProgress } from '../conflict/resolver.js';
import { getPlatform } from '../daemon/platform.js';
import { generateServiceName } from '../daemon/service-name.js';
import { isLocked, readLockFile } from '../lock.js';

export interface StatusFlags {
  path: string;
  label?: string;
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
  const dirPath = flags.path;

  const configPath = join(dirPath, '.syncthis.json');
  if (!(await fileExists(configPath))) {
    console.log('Not initialized (no .syncthis.json found).');
    console.log('Run: syncthis init --remote <url>');
    return;
  }

  // Load and display config
  let config: SyncthisConfig | null = null;
  try {
    config = await loadConfig(dirPath);
    console.log('Config:');
    console.log(`  Remote:   ${config.remote}`);
    console.log(`  Branch:   ${config.branch}`);
    const schedule = config.cron ?? `${config.interval}s`;
    console.log(`  Schedule: ${schedule}`);
    console.log(`  On conflict: ${config.onConflict}`);
    const logPath = join(dirPath, '.syncthis', 'logs', 'syncthis.log');
    console.log(`  Log:      ${logPath}`);
  } catch (err) {
    console.log(`Config: invalid – ${(err as Error).message}`);
  }

  // Check running process via lock file
  const lockStatus = await isLocked(dirPath);
  if (lockStatus.locked) {
    console.log(`\nSync process: running (PID: ${lockStatus.pid})`);
    const lockData = await readLockFile(dirPath);
    const runningSchedule =
      lockData?.schedule ??
      (config !== null ? (config.cron ?? `every ${config.interval}s`) : undefined);
    if (runningSchedule !== undefined) {
      console.log(`  Schedule: ${runningSchedule}`);
    }
  } else {
    console.log('\nSync process: not running');
  }

  // Git status
  console.log('\nGit:');
  try {
    const git = simpleGit(dirPath);

    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    console.log(`  Branch:              ${branch.trim()}`);

    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (origin !== undefined) {
      console.log(`  Remote:              ${origin.refs.fetch}`);
    }

    const statusOutput = await git.raw(['status', '--porcelain']);
    const uncommittedCount = statusOutput.split('\n').filter(Boolean).length;
    console.log(`  Uncommitted changes: ${uncommittedCount}`);

    const rebaseInProgress = await isRebaseInProgress(git);
    if (rebaseInProgress) {
      console.log('  Sync:                conflict (rebase in progress)');
      console.log(`  Run:                 syncthis resolve --path ${dirPath}`);
    }

    const logResult = await git.log({ maxCount: 1 });
    if (logResult.latest !== null) {
      console.log(`  Last commit:         ${logResult.latest.date} – ${logResult.latest.message}`);
    } else {
      console.log('  Last commit:         (none)');
    }
  } catch {
    console.log('  Not a git repository or git error.');
  }

  // Service status
  try {
    const platform = getPlatform();
    const label = flags.label ?? config?.daemonLabel;
    const serviceName = generateServiceName(dirPath, label ?? undefined);
    const serviceStatus = await platform.status(serviceName);

    if (serviceStatus.state === 'not-installed') {
      console.log('\nService: not installed');
    } else {
      const statusStr =
        serviceStatus.state === 'running' && serviceStatus.pid !== undefined
          ? `running (PID ${serviceStatus.pid})`
          : serviceStatus.state;
      const autostart = await platform.isAutostartEnabled(serviceName);
      const serviceLabel = serviceName.replace('com.syncthis.', '');

      console.log('\nService:');
      console.log(`  Status:    ${statusStr}`);
      console.log(`  Label:     ${serviceLabel}`);
      console.log(`  Autostart: ${autostart ? 'on' : 'off'}`);
    }
  } catch {
    // Platform not supported or other error — skip service section
  }
}
