import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron';
import { determineHealth } from '../../../cli/src/health-check.js';
import { stopService } from './cli-bridge.js';
import { readRegistry } from './ipc.js';
import { openDashboard } from './windows.js';

declare const POPOVER_VITE_DEV_SERVER_URL: string;
declare const POPOVER_VITE_NAME: string;

let tray: Tray | null = null;
let popoverWindow: BrowserWindow | null = null;
let syncingAnimTimer: ReturnType<typeof setInterval> | null = null;

const SYNCING_FRAMES = 8;
const SYNCING_INTERVAL_MS = 100;

function getTrayIconDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', '..', 'resources', 'tray');
}

function getTrayIconPath(state: 'idle' | 'syncing' | 'unhealthy', frame?: number): string {
  const dir = getTrayIconDir();
  const frameSuffix = frame !== undefined ? `-${frame}` : '';
  if (process.platform === 'linux') {
    return path.join(dir, `tray-${state}${frameSuffix}.png`);
  }
  return path.join(dir, `tray-${state}${frameSuffix}Template.png`);
}

function getPopoverUrl(): string {
  if (POPOVER_VITE_DEV_SERVER_URL) {
    return POPOVER_VITE_DEV_SERVER_URL;
  }
  return path.join(__dirname, `../renderer/${POPOVER_VITE_NAME}/index.html`);
}

export async function quitWithConfirmation(): Promise<void> {
  const paths = await readRegistry();
  const runningPaths: string[] = [];
  for (const dirPath of paths) {
    try {
      const result = await determineHealth(dirPath, null);
      if (result.processRunning) {
        runningPaths.push(dirPath);
      }
    } catch {
      // skip
    }
  }

  if (runningPaths.length > 0) {
    const n = runningPaths.length;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Cancel', 'Quit', 'Quit & Stop All'],
      defaultId: 1,
      title: 'Quit syncthis?',
      message:
        n === 1
          ? '1 sync service is currently running.'
          : `${n} sync services are currently running.`,
    });
    if (response === 0) return; // Cancel
    if (response === 2) {
      // Quit & Stop All
      await Promise.allSettled(runningPaths.map((p) => stopService(p)));
    }
  }

  app.exit(0);
}

export function createTray(): void {
  const iconPath = getTrayIconPath('idle');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('syncthis');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Dashboard', click: () => openDashboard() },
    { type: 'separator' },
    { label: 'Quit', click: () => void quitWithConfirmation() },
  ]);

  tray.on('click', (event) => {
    if (event.ctrlKey) {
      tray?.popUpContextMenu(contextMenu);
    } else {
      togglePopover();
    }
  });

  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });
}

function togglePopover(): void {
  if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }

  if (!popoverWindow || popoverWindow.isDestroyed()) {
    popoverWindow = createPopoverWindow();
    popoverWindow.setOpacity(0); // hidden until first resize reveals it
  }

  positionPopover();
  popoverWindow.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  popoverWindow.focus();
}

function createPopoverWindow(): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1a1918' : '#ffffff';
  const win = new BrowserWindow({
    width: 360,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const url = getPopoverUrl();
  if (url.startsWith('http')) {
    win.loadURL(url);
  } else {
    win.loadFile(url);
  }

  win.on('blur', () => {
    win.hide();
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      win.hide();
    }
  });

  return win;
}

function positionPopover(): void {
  if (!tray || !popoverWindow) return;

  const trayBounds = tray.getBounds();
  const windowBounds = popoverWindow.getBounds();

  // Fallback: if tray bounds are zero/invalid (some Linux DEs), center on primary screen
  if (trayBounds.width === 0 && trayBounds.height === 0) {
    const primary = screen.getPrimaryDisplay();
    const cx = Math.round(primary.workArea.x + primary.workArea.width / 2 - windowBounds.width / 2);
    const cy = Math.round(
      primary.workArea.y + primary.workArea.height / 2 - windowBounds.height / 2,
    );
    popoverWindow.setPosition(cx, cy, false);
    return;
  }

  const display = screen.getDisplayMatching(trayBounds);

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y =
    process.platform === 'darwin'
      ? trayBounds.y + trayBounds.height + 4
      : trayBounds.y - windowBounds.height - 4;

  const clampedX = Math.max(
    display.workArea.x,
    Math.min(x, display.workArea.x + display.workArea.width - windowBounds.width),
  );
  const clampedY = Math.max(
    display.workArea.y,
    Math.min(y, display.workArea.y + display.workArea.height - windowBounds.height),
  );

  popoverWindow.setPosition(clampedX, clampedY, false);
}

export function updateTrayIcon(state: 'idle' | 'syncing' | 'unhealthy'): void {
  if (!tray) return;

  // Stop any running animation
  if (syncingAnimTimer !== null) {
    clearInterval(syncingAnimTimer);
    syncingAnimTimer = null;
  }

  if (state === 'syncing') {
    let frameIndex = 0;
    tray.setImage(nativeImage.createFromPath(getTrayIconPath('syncing', 0)));
    syncingAnimTimer = setInterval(() => {
      if (!tray) return;
      frameIndex = (frameIndex + 1) % SYNCING_FRAMES;
      tray.setImage(nativeImage.createFromPath(getTrayIconPath('syncing', frameIndex)));
    }, SYNCING_INTERVAL_MS);
  } else {
    tray.setImage(nativeImage.createFromPath(getTrayIconPath(state)));
  }
}

export { openDashboard };
