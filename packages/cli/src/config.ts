import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cron } from 'croner';

export interface SyncthisConfig {
  remote: string;
  branch: string;
  cron: string | null;
  interval: number | null;
}

export interface CliFlags {
  branch?: string;
  cron?: string;
  interval?: number;
}

const CONFIG_FILENAME = '.syncthis.json';
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_CRON = '*/5 * * * *';

export function createDefaultConfig(remote: string, branch = DEFAULT_BRANCH): SyncthisConfig {
  return { remote, branch, cron: DEFAULT_CRON, interval: null };
}

export function validateConfig(config: unknown): SyncthisConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('Invalid .syncthis.json: expected an object.');
  }

  const raw = config as Record<string, unknown>;

  if (typeof raw.remote !== 'string' || raw.remote.trim() === '') {
    throw new Error('Invalid config: "remote" must be a non-empty string.');
  }

  let branch = DEFAULT_BRANCH;
  if (raw.branch !== undefined) {
    if (typeof raw.branch !== 'string' || raw.branch.trim() === '') {
      throw new Error('Invalid config: "branch" must be a non-empty string.');
    }
    branch = raw.branch.trim();
  }

  let cron: string | null = null;
  if (raw.cron !== undefined && raw.cron !== null) {
    if (typeof raw.cron !== 'string') {
      throw new Error('Invalid config: "cron" must be a string or null.');
    }
    cron = raw.cron;
  }

  let interval: number | null = null;
  if (raw.interval !== undefined && raw.interval !== null) {
    if (typeof raw.interval !== 'number') {
      throw new Error('Invalid config: "interval" must be a number or null.');
    }
    interval = raw.interval;
  }

  if (cron !== null && interval !== null) {
    throw new Error('Invalid config: "cron" and "interval" are mutually exclusive. Use one.');
  }
  if (cron === null && interval === null) {
    throw new Error('Invalid config: one of "cron" or "interval" must be set.');
  }

  if (cron !== null) {
    try {
      new Cron(cron, { paused: true });
    } catch {
      throw new Error(`Invalid cron expression: '${cron}'. Example: '*/5 * * * *'`);
    }
  }

  if (interval !== null) {
    if (!Number.isInteger(interval) || interval < 10) {
      throw new Error(
        `Invalid config: "interval" must be a positive integer >= 10, got ${interval}.`,
      );
    }
  }

  return { remote: raw.remote.trim(), branch, cron, interval };
}

export async function loadConfig(dirPath: string): Promise<SyncthisConfig> {
  const configPath = join(dirPath, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    throw new Error("Not initialized. Run 'syncthis init' first.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid .syncthis.json: not valid JSON.');
  }

  return validateConfig(parsed);
}

export async function writeConfig(dirPath: string, config: SyncthisConfig): Promise<void> {
  const configPath = join(dirPath, CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function mergeWithFlags(config: SyncthisConfig, flags: CliFlags): SyncthisConfig {
  const merged = { ...config };

  if (flags.cron !== undefined) {
    merged.cron = flags.cron;
    merged.interval = null;
  }

  if (flags.interval !== undefined) {
    merged.interval = flags.interval;
    merged.cron = null;
  }

  if (flags.branch !== undefined) {
    merged.branch = flags.branch;
  }

  return merged;
}
