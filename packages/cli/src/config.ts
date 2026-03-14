import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cron } from 'croner';

import type { CliFlags, SyncthisConfig } from '@syncthis/shared';

export type { CliFlags, ConflictStrategy, SyncthisConfig } from '@syncthis/shared';

const CONFIG_FILENAME = '.syncthis.json';
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_CRON = '*/5 * * * *';

export function createDefaultConfig(remote: string, branch = DEFAULT_BRANCH): SyncthisConfig {
  return { remote, branch, cron: DEFAULT_CRON, interval: null, onConflict: 'auto-both' };
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

  let daemonLabel: string | null | undefined;
  if (raw.daemonLabel !== undefined && raw.daemonLabel !== null) {
    if (typeof raw.daemonLabel !== 'string') {
      throw new Error('Invalid config: "daemonLabel" must be a string or null.');
    }
    daemonLabel = raw.daemonLabel;
  } else if (raw.daemonLabel === null) {
    daemonLabel = null;
  }

  let autostart: boolean | undefined;
  if (raw.autostart !== undefined) {
    if (typeof raw.autostart !== 'boolean') {
      throw new Error('Invalid config: "autostart" must be a boolean.');
    }
    autostart = raw.autostart;
  }

  const VALID_ON_CONFLICT = ['stop', 'auto-both', 'auto-newest', 'ask'] as const;
  let onConflict: 'stop' | 'auto-both' | 'auto-newest' | 'ask' = 'auto-both';
  if (raw.onConflict !== undefined && raw.onConflict !== null) {
    if (!VALID_ON_CONFLICT.includes(raw.onConflict as (typeof VALID_ON_CONFLICT)[number])) {
      throw new Error(
        `Invalid onConflict value: '${raw.onConflict}'. Allowed: stop, auto-both, auto-newest, ask`,
      );
    }
    onConflict = raw.onConflict as 'stop' | 'auto-both' | 'auto-newest' | 'ask';
  }

  let notify: boolean | undefined;
  if (raw.notify !== undefined) {
    if (typeof raw.notify !== 'boolean') {
      throw new Error('Invalid config: "notify" must be a boolean.');
    }
    notify = raw.notify;
  }

  return {
    remote: raw.remote.trim(),
    branch,
    cron,
    interval,
    daemonLabel,
    autostart,
    onConflict,
    notify,
  };
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
  const { onConflict, notify, ...rest } = config;
  let toWrite: Omit<SyncthisConfig, 'onConflict' | 'notify'> &
    Partial<Pick<SyncthisConfig, 'onConflict' | 'notify'>> = rest;
  if (onConflict !== 'auto-both') toWrite = { ...toWrite, onConflict };
  if (notify !== undefined && notify !== true) toWrite = { ...toWrite, notify };
  await writeFile(configPath, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
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

  if (flags.onConflict !== undefined) {
    merged.onConflict = flags.onConflict;
  }

  if (flags.notify !== undefined) {
    merged.notify = flags.notify;
  }

  return merged;
}
