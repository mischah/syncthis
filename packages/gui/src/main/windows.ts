import path from 'node:path';
import { BrowserWindow, app, nativeTheme } from 'electron';

declare const DASHBOARD_VITE_DEV_SERVER_URL: string;
declare const DASHBOARD_VITE_NAME: string;

let dashboardWindow: BrowserWindow | null = null;

function createDashboardWindow(): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1a1918' : '#ffffff';
  const win = new BrowserWindow({
    width: 775,
    height: 680,
    minWidth: 720,
    minHeight: 680,
    show: false,
    backgroundColor,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DASHBOARD_VITE_DEV_SERVER_URL) {
    win.loadURL(DASHBOARD_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${DASHBOARD_VITE_NAME}/index.html`));
  }

  win.on('close', (event) => {
    event.preventDefault();
    hideDashboard();
  });

  return win;
}

export function showDashboard(view?: string): void {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }
  dashboardWindow.show();
  dashboardWindow.focus();
  if (process.platform === 'darwin') app.dock.show();
  if (view) {
    const send = () => dashboardWindow?.webContents.send('app:navigate', { view });
    if (dashboardWindow.webContents.isLoading()) {
      dashboardWindow.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
}

export function hideDashboard(): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.hide();
  }
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
}

// Alias for backward compatibility
export const openDashboard = showDashboard;
