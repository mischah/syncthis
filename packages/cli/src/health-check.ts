import { Cron } from 'croner';
import type { SyncthisConfig } from './config.js';
import { type HealthFileData, readHealthFile } from './health.js';
import { isLocked, readLockFile } from './lock.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  reasons: string[];
  data: HealthFileData | null;
  processRunning: boolean;
  uptime: number | null;
}

const OVERDUE_MULTIPLIER = 3;
const UNHEALTHY_FAILURE_THRESHOLD = 5;

export function getExpectedIntervalMs(config: SyncthisConfig): number {
  if (config.interval !== null) {
    return config.interval * 1000;
  }
  if (config.cron !== null) {
    try {
      const job = new Cron(config.cron, { paused: true });
      const runs = job.nextRuns(2);
      if (runs.length === 2) {
        return runs[1].getTime() - runs[0].getTime();
      }
    } catch {
      // fall through to default
    }
  }
  return 5 * 60 * 1000; // 5 minutes default
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${totalSeconds} seconds`;
}

export async function determineHealth(
  dirPath: string,
  config: SyncthisConfig | null,
): Promise<HealthCheckResult> {
  const lockStatus = await isLocked(dirPath);
  const processRunning = lockStatus.locked;

  let uptime: number | null = null;
  if (processRunning) {
    const lockData = await readLockFile(dirPath);
    if (lockData?.startedAt !== undefined) {
      uptime = Math.floor((Date.now() - new Date(lockData.startedAt).getTime()) / 1000);
    }
  }

  const data = await readHealthFile(dirPath);
  const reasons: string[] = [];

  if (!processRunning) {
    reasons.push('Process not running');
    return { status: 'unhealthy', reasons, data, processRunning, uptime };
  }

  if (data === null) {
    // Process is running but no health data yet (first cycle hasn't completed)
    return { status: 'healthy', reasons, data, processRunning, uptime };
  }

  // Check consecutive failures
  if (data.consecutiveFailures >= UNHEALTHY_FAILURE_THRESHOLD) {
    reasons.push(`${data.consecutiveFailures} consecutive failures`);
  } else if (data.consecutiveFailures > 0) {
    reasons.push(
      `${data.consecutiveFailures} consecutive failure${data.consecutiveFailures === 1 ? '' : 's'}`,
    );
  }

  // Check if sync is overdue
  if (config !== null && data.lastSyncAt !== null) {
    const expectedMs = getExpectedIntervalMs(config);
    const overdueMs = expectedMs * OVERDUE_MULTIPLIER;
    const msSinceLastSync = Date.now() - new Date(data.lastSyncAt).getTime();
    if (msSinceLastSync > overdueMs) {
      const overdueBy = msSinceLastSync - expectedMs;
      reasons.push(`Sync overdue by ${formatDuration(overdueBy)}`);
    }
  }

  // Determine status from reasons
  let status: HealthStatus = 'healthy';
  if (data.consecutiveFailures >= UNHEALTHY_FAILURE_THRESHOLD) {
    status = 'unhealthy';
  } else if (reasons.length > 0) {
    status = 'degraded';
  }

  return { status, reasons, data, processRunning, uptime };
}
