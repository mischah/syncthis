import { access } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { type SyncthisConfig, loadConfig } from '../config.js';
import { isLocked, readLockFile } from '../lock.js';

export interface StatusFlags {
  path: string;
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
    console.log('Config: valid');
    console.log(`  Remote:   ${config.remote}`);
    console.log(`  Branch:   ${config.branch}`);
    const schedule = config.cron ?? `${config.interval}s`;
    console.log(`  Schedule: ${schedule}`);
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

    const logResult = await git.log({ maxCount: 1 });
    if (logResult.latest !== null) {
      console.log(`  Last commit:         ${logResult.latest.date} – ${logResult.latest.message}`);
    } else {
      console.log('  Last commit:         (none)');
    }
  } catch {
    console.log('  Not a git repository or git error.');
  }
}
