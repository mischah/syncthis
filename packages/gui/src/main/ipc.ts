import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import type {
  AppSettings,
  FolderDetail,
  FolderSummary,
  HealthStatus,
  LogEntry,
  ServiceStatus,
} from '@syncthis/shared';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { loadConfig, writeConfig } from '../../../cli/src/config.js';
import { determineHealth } from '../../../cli/src/health-check.js';
import { createLogger } from '../../../cli/src/logger.js';
import { runSyncCycle } from '../../../cli/src/sync.js';
import { loadAppSettings, saveAppSettings } from './app-settings.js';
import { runCli, startService, stopService } from './cli-bridge.js';
import {
  abortRebase,
  finalizeRebase,
  getConflictingFiles,
  getFileDiff,
  isRebaseInProgress,
  resolveFile as resolveConflictFile,
  resolveHunks,
} from './conflict.js';
import {
  configureRepoCredentialHelper,
  getCredentialScriptPath,
  setupCredentials,
  writeCredentialHelper,
} from './credentials.js';
import { getGitBinaryPath, getGitEnv, getSimpleGit } from './git-provider.js';
import { readRecentLogs, watchLogFile } from './log-parser.js';
import {
  checkAndNotifyPersistentFailures,
  checkAndNotifyServiceCrash,
  recordUserStop,
  showConflictNotification,
} from './notifications.js';
import {
  clearToken,
  createGitHubRepo,
  fetchUserRepos,
  loadToken,
  openDeviceAuthPage,
  pollOnce,
  requestDeviceCode,
} from './oauth.js';
import { updateTrayIcon } from './tray.js';
import { checkForUpdate, openReleasePage } from './updater.js';
import { hideDashboard, openDashboard } from './windows.js';

const REGISTRY_PATH = join(homedir(), '.syncthis', 'gui-folders.json');

/** Strip embedded auth credentials from error messages before they reach the renderer. */
function sanitizeError(message: string): string {
  return message.replace(/https?:\/\/[^@\s]+@/g, 'https://');
}

let lingerCheckResult: boolean | null = null;

const logWatchers = new Map<string, () => void>();
const previousConflictState = new Map<string, boolean>();
const previousServiceRunning = new Map<string, boolean>();

function broadcastConflictDetected(dirPath: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('conflict:detected', { dirPath });
  }
}

async function broadcastHealthChanged(dirPath: string): Promise<void> {
  const health = await getHealthStatus(dirPath);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('health:changed', health);
  }
}

function broadcastLogLine(dirPath: string, entry: LogEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('logs:line', { dirPath, entry });
  }
}

async function refreshTrayIcon(): Promise<void> {
  const paths = await readRegistry();
  const results = await Promise.allSettled(
    paths.map(async (dirPath) => ({
      health: await getHealthStatus(dirPath),
      conflict: await isRebaseInProgress(dirPath).catch(() => false),
    })),
  );
  const statuses = results
    .filter(
      (r): r is PromiseFulfilledResult<{ health: HealthStatus; conflict: boolean }> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value);

  const state = statuses.some(
    (s) => s.conflict || (s.health.serviceRunning && s.health.level !== 'healthy'),
  )
    ? 'unhealthy'
    : 'idle';
  updateTrayIcon(state);
}

async function readRegistry(): Promise<string[]> {
  try {
    const content = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(content) as string[];
  } catch {
    return [];
  }
}

async function writeRegistry(paths: string[]): Promise<void> {
  await writeFile(REGISTRY_PATH, `${JSON.stringify(paths, null, 2)}\n`, 'utf8');
}

async function getHealthStatus(dirPath: string): Promise<HealthStatus> {
  let config = null;
  try {
    config = await loadConfig(dirPath);
  } catch {
    // no config — treat as uninitialized
  }
  const result = await determineHealth(dirPath, config);
  return {
    dirPath,
    level: result.status,
    lastSync: result.data?.lastSyncAt ?? null,
    uptime: result.uptime,
    consecutiveFailures: result.data?.consecutiveFailures ?? 0,
    syncCycles: result.data?.cycleCount ?? 0,
    serviceRunning: result.processRunning,
    reasons: result.reasons,
  };
}

function toServiceStatus(serviceRunning: boolean): ServiceStatus {
  return serviceRunning ? 'running' : 'stopped';
}

export function startHealthPolling(): void {
  // Keep tray icon in sync with daemon activity even when no window is open.
  // Uses setTimeout (not setInterval) so a slow poll doesn't accumulate — the
  // next poll starts 10 seconds after the current one finishes.
  async function poll(): Promise<void> {
    try {
      await refreshTrayIcon();
      const paths = await readRegistry();
      await Promise.allSettled(
        paths.map(async (dirPath) => {
          try {
            const [health, config] = await Promise.all([
              getHealthStatus(dirPath),
              loadConfig(dirPath).catch(() => null),
            ]);
            if (config?.notify !== false) {
              const folderName = basename(dirPath);
              const prevRunning = previousServiceRunning.get(dirPath);
              if (prevRunning !== undefined) {
                checkAndNotifyServiceCrash(dirPath, folderName, prevRunning, health.serviceRunning);
              }
              checkAndNotifyPersistentFailures(dirPath, folderName, health.consecutiveFailures);
            }
            previousServiceRunning.set(dirPath, health.serviceRunning);
          } catch {
            // non-fatal
          }
        }),
      );
    } finally {
      setTimeout(() => {
        void poll();
      }, 10_000);
    }
  }

  setTimeout(() => {
    void poll();
  }, 10_000);
}

export function registerIpcHandlers(): void {
  ipcMain.handle('folders:list', async (): Promise<FolderSummary[]> => {
    const paths = await readRegistry();
    const results = await Promise.allSettled(
      paths.map(async (dirPath): Promise<FolderSummary> => {
        const [health, conflictDetected] = await Promise.all([
          getHealthStatus(dirPath),
          isRebaseInProgress(dirPath).catch(() => false),
        ]);
        const prev = previousConflictState.get(dirPath) ?? false;
        if (conflictDetected && !prev) {
          broadcastConflictDetected(dirPath);
          void showConflictNotification(dirPath);
        }
        previousConflictState.set(dirPath, conflictDetected);
        return {
          dirPath,
          name: basename(dirPath),
          health,
          serviceStatus: toServiceStatus(health.serviceRunning),
          conflictDetected,
        };
      }),
    );
    const summaries = results
      .filter((r): r is PromiseFulfilledResult<FolderSummary> => r.status === 'fulfilled')
      .map((r) => r.value);

    const trayState = summaries.some(
      (s) => s.conflictDetected || (s.health.serviceRunning && s.health.level !== 'healthy'),
    )
      ? 'unhealthy'
      : 'idle';
    updateTrayIcon(trayState);

    return summaries;
  });

  ipcMain.handle(
    'folders:detail',
    async (_, { dirPath }: { dirPath: string }): Promise<FolderDetail> => {
      const [config, health] = await Promise.all([loadConfig(dirPath), getHealthStatus(dirPath)]);

      let lastCommit = null;
      try {
        const git = getSimpleGit(dirPath);
        const log = await git.log({ maxCount: 1 });
        if (log.latest) {
          lastCommit = {
            hash: log.latest.hash,
            message: log.latest.message,
            author: log.latest.author_name,
            date: log.latest.date,
          };
        }
      } catch {
        // git info unavailable
      }

      return {
        dirPath,
        name: basename(dirPath),
        config,
        health,
        serviceStatus: toServiceStatus(health.serviceRunning),
        lastCommit,
      };
    },
  );

  ipcMain.handle(
    'health:status',
    async (_, { dirPath }: { dirPath: string }): Promise<HealthStatus> => {
      return getHealthStatus(dirPath);
    },
  );

  ipcMain.handle('health:all', async (): Promise<HealthStatus[]> => {
    const paths = await readRegistry();
    const results = await Promise.allSettled(paths.map((dirPath) => getHealthStatus(dirPath)));
    return results
      .filter((r): r is PromiseFulfilledResult<HealthStatus> => r.status === 'fulfilled')
      .map((r) => r.value);
  });

  function broadcastServiceState(dirPath: string, status: 'running' | 'stopped'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('service:state-changed', { dirPath, status });
    }
  }

  ipcMain.handle('service:start', async (_, { dirPath }: { dirPath: string }) => {
    return startService(dirPath);
  });

  ipcMain.handle(
    'service:broadcast-state',
    (_, { dirPath, status }: { dirPath: string; status: 'running' | 'stopped' }): void => {
      broadcastServiceState(dirPath, status);
    },
  );

  ipcMain.handle('service:stop', async (_, { dirPath }: { dirPath: string }) => {
    recordUserStop(dirPath);
    const result = await stopService(dirPath);
    broadcastServiceState(dirPath, 'stopped');
    return result;
  });

  ipcMain.handle('service:sync-now', async (_, { dirPath }: { dirPath: string }) => {
    updateTrayIcon('syncing');
    try {
      const config = await loadConfig(dirPath);
      const logger = createLogger({ level: 'debug', logDir: join(dirPath, '.syncthis', 'logs') });
      await runSyncCycle(dirPath, config, logger, {
        forceNonInteractive: true,
        gitBinary: getGitBinaryPath(),
        gitEnv: getGitEnv(),
      });
    } finally {
      await Promise.all([refreshTrayIcon(), broadcastHealthChanged(dirPath)]);
    }
  });

  ipcMain.handle('app:get-version', (): string => {
    return app.getVersion();
  });

  ipcMain.handle('app:check-update', async () => {
    return checkForUpdate(app.getVersion());
  });

  ipcMain.handle('app:dismiss-update', async (_, { version }: { version: string }) => {
    const settings = await loadAppSettings();
    settings.dismissedUpdateVersion = version;
    await saveAppSettings(settings);
  });

  ipcMain.handle('app:open-release-page', (_, { url }: { url: string }) => {
    openReleasePage(url);
  });

  ipcMain.handle(
    'app:reveal-in-file-manager',
    async (_, { dirPath }: { dirPath: string }): Promise<void> => {
      await shell.openPath(dirPath);
    },
  );

  ipcMain.handle(
    'app:open-dashboard',
    (_, args?: { view?: string; activeFolderPath?: string }): void => {
      openDashboard(args?.view, args?.activeFolderPath);
    },
  );

  ipcMain.handle('app:hide-dashboard', (): void => {
    hideDashboard();
  });

  ipcMain.handle('app:quit', async (): Promise<void> => {
    const { quitWithConfirmation } = await import('./tray.js');
    await quitWithConfirmation();
  });

  ipcMain.handle('folders:remove', async (_, { dirPath }: { dirPath: string }) => {
    await runCli(['uninstall', '--path', dirPath]);
    // Remove syncthis-specific files so the folder can be re-added later.
    // .git is intentionally preserved — git history must not be destroyed.
    await Promise.allSettled([
      rm(join(dirPath, '.syncthis.json'), { force: true }),
      rm(join(dirPath, '.syncthis'), { recursive: true, force: true }),
    ]);
    const paths = await readRegistry();
    await writeRegistry(paths.filter((p) => p !== dirPath));
    broadcastServiceState(dirPath, 'stopped');
  });

  ipcMain.handle('app:resize-popover', (event, { height }: { height: number }): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setSize(360, Math.min(Math.max(height, 80), 640));
      if (win.getOpacity() < 1) win.setOpacity(1);
    }
  });

  ipcMain.handle('app:settings-read', async (): Promise<AppSettings> => {
    return loadAppSettings();
  });

  ipcMain.handle('app:settings-write', async (_, settings: AppSettings): Promise<void> => {
    await saveAppSettings(settings);
    app.setLoginItemSettings({ openAtLogin: settings.launchOnLogin });
  });

  ipcMain.handle('app:linger-status', async (): Promise<{ show: boolean }> => {
    if (process.platform !== 'linux') return { show: false };
    const settings = await loadAppSettings();
    if (settings.lingerWarningDismissed) return { show: false };
    if (lingerCheckResult !== null) return { show: lingerCheckResult };
    try {
      const user = process.env.USER ?? process.env.LOGNAME ?? '';
      const { stdout } = await execFileAsync('loginctl', ['show-user', user, '-p', 'Linger']);
      lingerCheckResult = stdout.trim() === 'Linger=no';
    } catch {
      lingerCheckResult = false;
    }
    return { show: lingerCheckResult };
  });

  ipcMain.handle('app:dismiss-linger', async (): Promise<void> => {
    lingerCheckResult = false;
    const settings = await loadAppSettings();
    settings.lingerWarningDismissed = true;
    await saveAppSettings(settings);
  });

  ipcMain.handle('github:start-auth', async () => {
    const deviceCode = await requestDeviceCode();
    openDeviceAuthPage(deviceCode.verification_uri);
    return {
      verificationUri: deviceCode.verification_uri,
      userCode: deviceCode.user_code,
      deviceCode: deviceCode.device_code,
      interval: deviceCode.interval,
      expiresIn: deviceCode.expires_in,
    };
  });

  ipcMain.handle(
    'github:poll-auth',
    async (_, { deviceCode }: { deviceCode: string; interval: number }) => {
      return pollOnce(deviceCode);
    },
  );

  ipcMain.handle('github:list-repos', async () => {
    const token = await loadToken();
    if (!token) throw new Error('Not authenticated');
    return fetchUserRepos(token);
  });

  ipcMain.handle('github:status', async () => {
    const token = await loadToken();
    if (!token) return { connected: false };
    const settings = await loadAppSettings();
    return { connected: true, username: settings.github.username };
  });

  ipcMain.handle('github:create-repo', async (_, { name }: { name: string }) => {
    const token = await loadToken();
    if (!token) throw new Error('Not authenticated with GitHub');
    return createGitHubRepo(token, name);
  });

  ipcMain.handle('github:disconnect', async () => {
    await clearToken();
  });

  ipcMain.handle('github:open-auth-page', async (_, { url }: { url: string }): Promise<void> => {
    await shell.openExternal(url);
  });

  ipcMain.handle('config:read', async (_, { dirPath }: { dirPath: string }) => {
    return loadConfig(dirPath);
  });

  ipcMain.handle(
    'config:write',
    async (
      _,
      { dirPath, config }: { dirPath: string; config: Parameters<typeof writeConfig>[1] },
    ) => {
      await writeConfig(dirPath, config);
    },
  );

  ipcMain.handle('gitignore:read', async (_, { dirPath }: { dirPath: string }): Promise<string> => {
    try {
      return await readFile(join(dirPath, '.gitignore'), 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle(
    'gitignore:write',
    async (_, { dirPath, content }: { dirPath: string; content: string }): Promise<void> => {
      await writeFile(join(dirPath, '.gitignore'), content, 'utf8');
    },
  );

  ipcMain.handle(
    'logs:recent',
    async (_, { dirPath, maxLines }: { dirPath: string; maxLines?: number }) => {
      return readRecentLogs(dirPath, maxLines);
    },
  );

  ipcMain.handle('logs:subscribe', (_, { dirPath }: { dirPath: string }): undefined => {
    if (logWatchers.has(dirPath)) return;
    const unsubscribe = watchLogFile(dirPath, (entry) => {
      broadcastLogLine(dirPath, entry);
    });
    logWatchers.set(dirPath, unsubscribe);
  });

  ipcMain.handle('logs:unsubscribe', (_, { dirPath }: { dirPath: string }): undefined => {
    const unsubscribe = logWatchers.get(dirPath);
    if (unsubscribe) {
      unsubscribe();
      logWatchers.delete(dirPath);
    }
  });

  ipcMain.handle('credentials:setup', async (_, { dirPath }: { dirPath: string }) => {
    const token = await loadToken();
    if (!token) throw new Error('Not authenticated with GitHub');
    await setupCredentials(dirPath, token);
  });

  ipcMain.handle('app:open-folder-picker', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    'folders:add',
    async (
      _,
      args: {
        mode: 'clone' | 'existing';
        repoUrl: string;
        dirPath: string;
        interval: number;
        onConflict: 'auto-both' | 'auto-newest' | 'ask';
        useOAuth: boolean;
      },
    ) => {
      const expandedPath = args.dirPath.startsWith('~')
        ? join(homedir(), args.dirPath.slice(1))
        : args.dirPath;

      // 0. Pre-flight: for existing-folder mode the directory must already exist
      if (args.mode === 'existing') {
        try {
          await access(expandedPath);
        } catch {
          throw new Error(
            `The folder "${basename(expandedPath)}" does not exist. Please choose an existing folder.`,
          );
        }
      }

      // 1. Write credential helper script before clone (file only, no git config yet)
      if (args.useOAuth) {
        const token = await loadToken();
        if (token) {
          await writeCredentialHelper(expandedPath, token);
        }
      }

      // 2. Run syncthis init — embed token in URL for clone so git can authenticate
      let effectiveUrl = args.repoUrl;
      if (args.useOAuth && args.mode === 'clone' && args.repoUrl.startsWith('https://')) {
        const token = await loadToken();
        if (token) {
          effectiveUrl = args.repoUrl.replace('https://', `https://x-access-token:${token}@`);
        }
      }
      const initArgs =
        args.mode === 'clone'
          ? ['init', '--clone', effectiveUrl, '--path', expandedPath]
          : ['init', '--remote', args.repoUrl, '--path', expandedPath];
      const initResult = await runCli(initArgs);
      if (!initResult.ok) {
        if (initResult.error.code === 'REMOTE_CONFLICT') {
          throw new Error(
            'This folder is already linked to a different repository. ' +
              'Choose a different folder, or remove the existing Git connection first.',
          );
        }
        throw new Error(sanitizeError(initResult.error.message));
      }

      // 3. Configure credential helper in git config now that the repo exists
      if (args.useOAuth) {
        try {
          await configureRepoCredentialHelper(expandedPath, getCredentialScriptPath(expandedPath));
        } catch {
          // non-fatal: folder is usable without the helper
        }
      }

      // 4. Run syncthis start (non-fatal: folder is registered even if start fails)
      const startResult = await runCli([
        'start',
        '--path',
        expandedPath,
        '--interval',
        String(args.interval),
        '--on-conflict',
        args.onConflict,
      ]);

      // 5. Add to GUI folder registry
      const paths = await readRegistry();
      if (!paths.includes(expandedPath)) {
        await writeRegistry([...paths, expandedPath]);
      }

      // 6. Return summary
      return {
        dirPath: expandedPath,
        name: basename(expandedPath),
        remote: args.repoUrl,
        interval: args.interval,
        serviceStarted: startResult.ok,
      };
    },
  );

  ipcMain.handle('conflict:check', async (_, { dirPath }: { dirPath: string }) => {
    return isRebaseInProgress(dirPath).catch(() => false);
  });

  ipcMain.handle('conflict:list-files', async (_, { dirPath }: { dirPath: string }) => {
    return getConflictingFiles(dirPath);
  });

  ipcMain.handle(
    'conflict:get-diff',
    async (_, { dirPath, filePath }: { dirPath: string; filePath: string }) => {
      return getFileDiff(dirPath, filePath);
    },
  );

  ipcMain.handle(
    'conflict:resolve-file',
    async (
      _,
      {
        dirPath,
        filePath,
        choice,
      }: { dirPath: string; filePath: string; choice: 'local' | 'remote' | 'both' },
    ) => {
      await resolveConflictFile(dirPath, filePath, choice);
    },
  );

  ipcMain.handle(
    'conflict:resolve-hunks',
    async (
      _,
      {
        dirPath,
        filePath,
        decisions,
      }: { dirPath: string; filePath: string; decisions: Array<'local' | 'remote'> },
    ) => {
      await resolveHunks(dirPath, filePath, decisions);
    },
  );

  ipcMain.handle('conflict:abort', async (_, { dirPath }: { dirPath: string }) => {
    await abortRebase(dirPath);
    void refreshTrayIcon();
  });

  ipcMain.handle('conflict:finalize', async (_, { dirPath }: { dirPath: string }) => {
    await finalizeRebase(dirPath);
    void refreshTrayIcon();
  });

  ipcMain.handle('git:validate-remote', async (_, { url }: { url: string }) => {
    try {
      let effectiveUrl = url;
      if (url.startsWith('https://')) {
        const token = await loadToken();
        if (token) {
          effectiveUrl = url.replace('https://', `https://x-access-token:${token}@`);
        }
      }
      await execFileAsync(getGitBinaryPath(), ['ls-remote', effectiveUrl], {
        timeout: 15000,
        env: { ...process.env, ...getGitEnv() },
      });
      return { valid: true };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

export { readRegistry, writeRegistry };
