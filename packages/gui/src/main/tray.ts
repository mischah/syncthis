import path from 'node:path';
import { BrowserWindow, Tray, app, nativeImage, nativeTheme, screen } from 'electron';
import { openDashboard } from './windows.js';

declare const POPOVER_VITE_DEV_SERVER_URL: string;
declare const POPOVER_VITE_NAME: string;

let tray: Tray | null = null;
let popoverWindow: BrowserWindow | null = null;

function getTrayIconDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', '..', 'resources', 'tray');
}

function getTrayIconPath(state: 'idle' | 'syncing' | 'warning' | 'error'): string {
  const dir = getTrayIconDir();
  if (process.platform === 'linux') {
    return path.join(dir, `tray-${state}.png`);
  }
  return path.join(dir, `tray-${state}Template.png`);
}

function getPopoverUrl(): string {
  if (POPOVER_VITE_DEV_SERVER_URL) {
    return POPOVER_VITE_DEV_SERVER_URL;
  }
  return path.join(__dirname, `../renderer/${POPOVER_VITE_NAME}/index.html`);
}

export function createTray(): void {
  const iconPath = getTrayIconPath('idle');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('syncthis');

  tray.on('click', () => {
    togglePopover();
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

export function updateTrayIcon(state: 'idle' | 'syncing' | 'warning' | 'error'): void {
  if (!tray) return;
  const iconPath = getTrayIconPath(state);
  tray.setImage(nativeImage.createFromPath(iconPath));
}

export { openDashboard };
