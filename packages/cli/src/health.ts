import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SyncResult } from './sync.js';

const HEALTH_FILENAME = '.syncthis/health.json';

export interface HealthFileData {
  startedAt: string;
  lastSyncAt: string | null;
  lastSyncResult: SyncResult['status'] | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  cycleCount: number;
}

export async function readHealthFile(dirPath: string): Promise<HealthFileData | null> {
  try {
    const content = await readFile(join(dirPath, HEALTH_FILENAME), 'utf8');
    return JSON.parse(content) as HealthFileData;
  } catch {
    return null;
  }
}

export async function writeHealthFile(dirPath: string, data: HealthFileData): Promise<void> {
  const filePath = join(dirPath, HEALTH_FILENAME);
  await mkdir(join(dirPath, '.syncthis'), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const SUCCESS_STATUSES: ReadonlySet<SyncResult['status']> = new Set([
  'no-changes',
  'pulled',
  'synced',
]);

export async function updateHealthAfterCycle(
  dirPath: string,
  syncResult: SyncResult,
  startedAt: string,
): Promise<void> {
  const existing = await readHealthFile(dirPath);
  const now = new Date().toISOString();
  const isSuccess = SUCCESS_STATUSES.has(syncResult.status);

  const updated: HealthFileData = {
    startedAt: existing?.startedAt ?? startedAt,
    lastSyncAt: now,
    lastSyncResult: syncResult.status,
    consecutiveFailures: isSuccess ? 0 : (existing?.consecutiveFailures ?? 0) + 1,
    lastSuccessAt: isSuccess ? now : (existing?.lastSuccessAt ?? null),
    cycleCount: (existing?.cycleCount ?? 0) + 1,
  };

  await writeHealthFile(dirPath, updated);
}
