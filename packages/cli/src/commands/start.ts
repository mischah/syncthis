import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type SyncthisConfig, loadConfig, mergeWithFlags } from '../config.js';
import { acquireLock, releaseLock } from '../lock.js';
import { type LogLevel, createLogger } from '../logger.js';
import { type SchedulerHandle, startScheduler } from '../scheduler.js';
import { runSyncCycle } from '../sync.js';
import type { BatchResult } from './daemon.js';

const execFileAsync = promisify(execFile);

export interface StartFlags {
  path: string;
  foreground?: boolean;
  cron?: string;
  interval?: number;
  onConflict?: string;
  logLevel: string;
  label?: string;
  enableAutostart?: boolean;
  all?: boolean;
}

const VALID_ON_CONFLICT = ['stop', 'auto-both', 'auto-newest', 'ask'] as const;

export async function handleStart(flags: StartFlags): Promise<void> {
  if (flags.onConflict !== undefined && !VALID_ON_CONFLICT.includes(flags.onConflict as never)) {
    console.error(
      `Error: Invalid --on-conflict value: '${flags.onConflict}'. Allowed: stop, auto-both, auto-newest, ask`,
    );
    process.exit(1);
  }

  if (flags.foreground) {
    await runForeground(flags);
    return;
  }

  const { daemonStart, getPlatformOrExit, printBatchSummary } = await import('./daemon.js');

  if (flags.all) {
    const platform = getPlatformOrExit();
    const daemons = await platform.listAll();
    if (daemons.length === 0) {
      console.log('No syncthis services registered.');
      return;
    }
    const results: BatchResult[] = [];
    for (const d of daemons) {
      if (d.state === 'running') {
        results.push({
          label: d.label,
          dirPath: d.dirPath,
          outcome: 'skipped',
          message: 'already running',
        });
        continue;
      }
      try {
        await daemonStart({ path: d.dirPath });
        results.push({ label: d.label, dirPath: d.dirPath, outcome: 'ok', message: 'started' });
      } catch (err) {
        results.push({
          label: d.label,
          dirPath: d.dirPath,
          outcome: 'failed',
          message: (err as Error).message,
        });
      }
    }
    printBatchSummary(results);
    if (results.some((r) => r.outcome === 'failed')) process.exit(1);
    return;
  }

  try {
    await daemonStart({
      path: flags.path,
      label: flags.label,
      enableAutostart: flags.enableAutostart,
      cron: flags.cron,
      interval: flags.interval,
      onConflict: flags.onConflict,
      logLevel: flags.logLevel,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function runForeground(flags: StartFlags): Promise<void> {
  const dirPath = flags.path;

  // Check git availability
  try {
    await execFileAsync('git', ['--version']);
  } catch {
    console.error('Error: git not found. Please install git first.');
    process.exit(1);
  }

  // Validate flag mutual exclusivity
  if (flags.cron !== undefined && flags.interval !== undefined) {
    console.error('Error: --cron and --interval are mutually exclusive. Use one.');
    process.exit(1);
  }

  // Load and validate config
  let rawConfig: SyncthisConfig;
  try {
    rawConfig = await loadConfig(dirPath);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  const config = mergeWithFlags(rawConfig, {
    cron: flags.cron,
    interval: flags.interval,
    onConflict: flags.onConflict as (typeof VALID_ON_CONFLICT)[number] | undefined,
  });

  // Resolve log level
  const validLevels: readonly string[] = ['debug', 'info', 'warn', 'error'];
  const logLevel: LogLevel = validLevels.includes(flags.logLevel)
    ? (flags.logLevel as LogLevel)
    : 'info';

  const logDir = join(dirPath, '.syncthis', 'logs');
  const logger = createLogger({ level: logLevel, logDir });

  const schedule = config.cron ?? `${config.interval}s`;

  // Acquire lock (removes stale locks automatically)
  try {
    await acquireLock(dirPath, schedule);
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }

  let isShuttingDown = false;
  let schedulerHandle: SchedulerHandle | null = null;

  async function gracefulShutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('Shutdown signal received. Finishing current sync cycle...');
    if (schedulerHandle !== null) {
      schedulerHandle.stop();
    }
    await releaseLock(dirPath);
    logger.info('Shutdown complete.');
    process.exit(0);
  }

  process.on('SIGINT', () => {
    void gracefulShutdown();
  });
  process.on('SIGTERM', () => {
    void gracefulShutdown();
  });

  logger.info(`Sync started. Schedule: ${schedule}. Watching: ${dirPath}`);

  // Run initial sync cycle
  const initialResult = await runSyncCycle(dirPath, config, logger);
  if (initialResult.status === 'conflict') {
    // ask + non-TTY: don't exit, fall through to scheduler
    // Subsequent cycles will skip via isRebaseInProgress until user runs 'syncthis resolve'
    if (config.onConflict === 'ask' && !process.stdin.isTTY) {
      // Fall through
    } else {
      await releaseLock(dirPath);
      process.exit(1);
    }
  }

  // Start scheduler
  schedulerHandle = startScheduler(config, async () => {
    if (isShuttingDown) return;
    const result = await runSyncCycle(dirPath, config, logger);
    if (result.status === 'conflict') {
      // ask + non-TTY: keep running, don't exit
      if (config.onConflict === 'ask' && !process.stdin.isTTY) return;

      if (schedulerHandle !== null) {
        schedulerHandle.stop();
      }
      await releaseLock(dirPath);
      process.exit(1);
    }
  });
}
