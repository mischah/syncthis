import { app } from 'electron';
import { loadAppSettings } from './app-settings.js';
import { ensureCliBundled } from './cli-bundler.js';
import { readRegistry, registerIpcHandlers } from './ipc.js';
import { createTray } from './tray.js';
import { openDashboard } from './windows.js';

app.on('ready', async () => {
  console.log('syncthis GUI started');

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  try {
    await ensureCliBundled();
  } catch (err) {
    console.error('Failed to bundle CLI:', err);
  }

  registerIpcHandlers();
  createTray();

  const settings = await loadAppSettings();
  app.setLoginItemSettings({ openAtLogin: settings.launchOnLogin });

  // Open dashboard on first launch (no folders registered yet)
  const folders = await readRegistry();
  if (folders.length === 0) {
    openDashboard();
  }
});

app.on('window-all-closed', () => {
  // App lives in the tray — don't quit when all windows close
});

app.on('activate', () => {
  // macOS: open dashboard if dock icon is clicked (e.g., visible during setup)
  openDashboard();
});
