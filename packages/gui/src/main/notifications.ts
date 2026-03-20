import { basename } from 'node:path';
import { Notification } from 'electron';
import { loadConfig } from '../../../cli/src/config.js';
import { getConflictingFiles } from './conflict.js';
import { openDashboard } from './windows.js';

const CRASH_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const USER_STOP_GRACE_MS = 30 * 1000; // 30 seconds

/** Per-folder timestamp of last crash notification shown. */
const lastCrashNotified = new Map<string, number>();

/** Per-folder: whether we've already notified for the current failure streak. */
const failureNotifiedStreak = new Set<string>();

/** Per-folder timestamp when a user-initiated stop was recorded. */
const userStops = new Map<string, number>();

const activeNotifications = new Set<Electron.Notification>();

/** Call this when the user explicitly stops a service via IPC. */
export function recordUserStop(dirPath: string): void {
  userStops.set(dirPath, Date.now());
}

function wasUserInitiatedStop(dirPath: string): boolean {
  const ts = userStops.get(dirPath);
  if (ts === undefined) return false;
  const recent = Date.now() - ts < USER_STOP_GRACE_MS;
  userStops.delete(dirPath);
  return recent;
}

function showNotification(title: string, body: string, onClick: () => void): void {
  const notification = new Notification({ title, body });
  activeNotifications.add(notification);
  notification.on('click', () => {
    onClick();
    activeNotifications.delete(notification);
  });
  notification.on('close', () => {
    activeNotifications.delete(notification);
  });
  notification.show();
}

/**
 * Show a crash notification if the service transitioned from running → stopped
 * without a user-initiated stop. Debounced per folder to 5 minutes.
 */
export function checkAndNotifyServiceCrash(
  dirPath: string,
  folderName: string,
  previouslyRunning: boolean,
  currentlyRunning: boolean,
): void {
  if (!previouslyRunning || currentlyRunning) return;
  if (wasUserInitiatedStop(dirPath)) return;

  const now = Date.now();
  const lastNotified = lastCrashNotified.get(dirPath) ?? 0;
  if (now - lastNotified < CRASH_DEBOUNCE_MS) return;

  lastCrashNotified.set(dirPath, now);
  showNotification(
    `Sync stopped for ${folderName}`,
    'The background service stopped unexpectedly.',
    () => openDashboard('detail', dirPath),
  );
}

/**
 * Show a persistent-failure notification once per failure streak (≥3 failures).
 * Resets when consecutiveFailures drops back to 0.
 */
export function checkAndNotifyPersistentFailures(
  dirPath: string,
  folderName: string,
  consecutiveFailures: number,
): void {
  if (consecutiveFailures === 0) {
    failureNotifiedStreak.delete(dirPath);
    return;
  }
  if (consecutiveFailures < 3) return;
  if (failureNotifiedStreak.has(dirPath)) return;

  failureNotifiedStreak.add(dirPath);
  showNotification(
    `Sync issues with ${folderName}`,
    `Sync has failed ${consecutiveFailures} times. Check your connection.`,
    () => openDashboard('detail', dirPath),
  );
}

/** Show a conflict notification for the given folder (respects notify config). */
export async function showConflictNotification(dirPath: string): Promise<void> {
  try {
    const config = await loadConfig(dirPath);
    if (config.notify === false) return;
    const files = await getConflictingFiles(dirPath).catch(() => []);
    const fileCount = files.length || 1;
    showNotification(
      `Conflict in ${basename(dirPath)}`,
      `${fileCount} file${fileCount > 1 ? 's have' : ' has'} conflicting changes. Click to resolve.`,
      () => openDashboard('conflict', dirPath),
    );
  } catch {
    // non-fatal
  }
}
