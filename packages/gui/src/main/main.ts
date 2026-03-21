import { Menu, app } from 'electron';
import { loadAppSettings } from './app-settings.js';
import { ensureCliBundled } from './cli-bundler.js';
import { initGitProvider } from './git-provider.js';
import { readRegistry, registerIpcHandlers, startHealthPolling } from './ipc.js';
import { createTray } from './tray.js';
import { startUpdateChecker } from './updater.js';
import { hideDashboard, openDashboard } from './windows.js';

const _startupTimestamp = Date.now();

app.on('ready', async () => {
  console.log(`[startup] app ready at +${Date.now() - _startupTimestamp}ms`);

  if (process.platform === 'darwin') {
    app.dock.hide();

    // Override Cmd+Q: hide dashboard instead of quitting.
    // Actual quit is only available via tray context menu → Quit.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            {
              label: 'Quit',
              accelerator: 'CmdOrCtrl+Q',
              click: () => hideDashboard(),
            },
          ],
        },
        { role: 'editMenu' },
      ]),
    );
  }

  try {
    await ensureCliBundled();
  } catch (err) {
    console.error('Failed to bundle CLI:', err);
  }

  try {
    await initGitProvider();
  } catch (err) {
    console.error('Failed to initialize git provider:', err);
  }

  registerIpcHandlers();
  startHealthPolling();
  startUpdateChecker(app.getVersion());

  try {
    createTray();
    console.log(`[startup] tray created at +${Date.now() - _startupTimestamp}ms`);
  } catch (err) {
    console.warn('Tray creation failed (expected on some Linux DEs without AppIndicator):', err);
  }

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
