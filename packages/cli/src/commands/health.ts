import { loadConfig } from '../config.js';
import { getPlatform } from '../daemon/platform.js';
import { type HealthCheckResult, determineHealth } from '../health-check.js';
import { type HealthData, printJson, printJsonError } from '../json-output.js';

export interface HealthFlags {
  path: string;
  label?: string;
  all?: boolean;
  pathExplicit?: boolean;
  json?: boolean;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function printHealthResult(_dirPath: string, result: HealthCheckResult, label?: string): void {
  const { status, reasons, data, processRunning, uptime } = result;
  const statusSymbol = status === 'healthy' ? '✓' : status === 'degraded' ? '⚠' : '✗';
  const header =
    label !== undefined
      ? `Health (${label}): ${status} ${statusSymbol}`
      : `Health: ${status} ${statusSymbol}`;
  console.log(header);

  if (reasons.length > 0) {
    console.log('  Reasons:');
    for (const reason of reasons) {
      console.log(`    - ${reason}`);
    }
  }

  if (data !== null) {
    const lastSync =
      data.lastSyncAt !== null
        ? `${formatRelativeTime(data.lastSyncAt)} (${data.lastSyncResult ?? 'unknown'})`
        : 'never';
    console.log(`  Last sync:    ${lastSync}`);
    if (uptime !== null) {
      console.log(`  Uptime:       ${formatUptime(uptime)}`);
    }
    console.log(`  Failures:     ${data.consecutiveFailures} consecutive`);
    console.log(`  Sync cycles:  ${data.cycleCount}`);
  } else if (processRunning) {
    console.log('  No sync cycle completed yet.');
    if (uptime !== null) {
      console.log(`  Uptime:       ${formatUptime(uptime)}`);
    }
  }
}

function toHealthData(dirPath: string, result: HealthCheckResult): HealthData {
  return {
    dirPath,
    status: result.status,
    reasons: result.reasons,
    processRunning: result.processRunning,
    uptime: result.uptime,
    lastSyncAt: result.data?.lastSyncAt ?? null,
    lastSyncResult: result.data?.lastSyncResult ?? null,
    consecutiveFailures: result.data?.consecutiveFailures ?? 0,
    lastSuccessAt: result.data?.lastSuccessAt ?? null,
    cycleCount: result.data?.cycleCount ?? 0,
  };
}

export async function handleHealth(flags: HealthFlags): Promise<void> {
  if (flags.all) {
    let platform: ReturnType<typeof getPlatform>;
    try {
      platform = getPlatform();
    } catch (err) {
      if (flags.json) printJsonError('health', (err as Error).message);
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }

    const daemons = await platform.listAll();
    if (daemons.length === 0) {
      if (flags.json) printJson('health', { services: [] });
      else console.log('No syncthis services registered.');
      return;
    }

    const results: HealthData[] = [];
    for (const d of daemons) {
      let config = null;
      try {
        config = await loadConfig(d.dirPath);
      } catch {
        // no config, health will still work
      }
      const result = await determineHealth(d.dirPath, config);
      results.push(toHealthData(d.dirPath, result));

      if (!flags.json) {
        printHealthResult(d.dirPath, result, d.label);
        console.log();
      }
    }

    if (flags.json) {
      printJson('health', { services: results });
    }
    return;
  }

  const dirPath = flags.path;
  let config = null;
  try {
    config = await loadConfig(dirPath);
  } catch {
    // no config — health still works
  }

  const result = await determineHealth(dirPath, config);

  if (flags.json) {
    printJson('health', toHealthData(dirPath, result));
    return;
  }

  printHealthResult(dirPath, result);
}
