import path from 'node:path';
import { BrowserWindow, app, nativeTheme } from 'electron';

declare const DASHBOARD_VITE_DEV_SERVER_URL: string;
declare const DASHBOARD_VITE_NAME: string;

let dashboardWindow: BrowserWindow | null = null;

function createDashboardWindow(): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1a1918' : '#ffffff';
  const win = new BrowserWindow({
    width: 775,
    height: 480,
    minWidth: 720,
    minHeight: 480,
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

export function showDashboard(): void {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = createDashboardWindow();
  }
  dashboardWindow.show();
  dashboardWindow.focus();
  if (process.platform === 'darwin') app.dock.show();
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
