import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  AppSettings,
  FolderDetail,
  FolderSummary,
  HealthStatus,
  LogEntry,
  ServiceStatus,
} from '@syncthis/shared';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import simpleGit from 'simple-git';
import { loadConfig, writeConfig } from '../../../cli/src/config.js';
import { determineHealth } from '../../../cli/src/health-check.js';
import { createLogger } from '../../../cli/src/logger.js';
import { runSyncCycle } from '../../../cli/src/sync.js';
import { loadAppSettings, saveAppSettings } from './app-settings.js';
import { runCli, startService, stopService } from './cli-bridge.js';
import { readRecentLogs, watchLogFile } from './log-parser.js';
import { hideDashboard, openDashboard } from './windows.js';

const REGISTRY_PATH = join(homedir(), '.syncthis', 'gui-folders.json');

const logWatchers = new Map<string, () => void>();

function broadcastLogLine(dirPath: string, entry: LogEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('logs:line', { dirPath, entry });
  }
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
  };
}

function toServiceStatus(serviceRunning: boolean): ServiceStatus {
  return serviceRunning ? 'running' : 'stopped';
}

export function registerIpcHandlers(): void {
  ipcMain.handle('folders:list', async (): Promise<FolderSummary[]> => {
    const paths = await readRegistry();
    const results = await Promise.allSettled(
      paths.map(async (dirPath): Promise<FolderSummary> => {
        const health = await getHealthStatus(dirPath);
        return {
          dirPath,
          name: basename(dirPath),
          health,
          serviceStatus: toServiceStatus(health.serviceRunning),
        };
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<FolderSummary> => r.status === 'fulfilled')
      .map((r) => r.value);
  });

  ipcMain.handle(
    'folders:detail',
    async (_, { dirPath }: { dirPath: string }): Promise<FolderDetail> => {
      const [config, health] = await Promise.all([loadConfig(dirPath), getHealthStatus(dirPath)]);

      let lastCommit = null;
      try {
        const git = simpleGit(dirPath);
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
    const result = await stopService(dirPath);
    broadcastServiceState(dirPath, 'stopped');
    return result;
  });

  ipcMain.handle('service:sync-now', async (_, { dirPath }: { dirPath: string }) => {
    const config = await loadConfig(dirPath);
    const logger = createLogger({ level: 'debug', logDir: join(dirPath, '.syncthis') });
    await runSyncCycle(dirPath, config, logger);
  });

  ipcMain.handle('app:get-version', (): string => {
    return app.getVersion();
  });

  ipcMain.handle(
    'app:reveal-in-file-manager',
    async (_, { dirPath }: { dirPath: string }): Promise<void> => {
      await shell.openPath(dirPath);
    },
  );

  ipcMain.handle('app:open-dashboard', (_, args?: { view?: string }): void => {
    openDashboard(args?.view);
  });

  ipcMain.handle('app:hide-dashboard', (): void => {
    hideDashboard();
  });

  ipcMain.handle('app:quit', (): void => {
    app.exit(0);
  });

  ipcMain.handle('folders:remove', async (_, { dirPath }: { dirPath: string }) => {
    await runCli(['uninstall', '--path', dirPath]);
    const paths = await readRegistry();
    await writeRegistry(paths.filter((p) => p !== dirPath));
    broadcastServiceState(dirPath, 'stopped');
  });

  ipcMain.handle('app:resize-popover', (event, { height }: { height: number }): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setSize(360, Math.min(Math.max(height, 80), 520));
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
}

export { readRegistry, writeRegistry };
