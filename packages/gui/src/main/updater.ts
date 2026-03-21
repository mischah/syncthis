import type { UpdateInfo } from '@syncthis/shared';
import { autoUpdater, BrowserWindow, Notification, net, shell } from 'electron';

import { loadAppSettings } from './app-settings.js';

export type { UpdateInfo };

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function broadcastUpdate(info: UpdateInfo): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:available', info);
  }
}

export function openReleasePage(url: string): void {
  void shell.openExternal(url);
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

// ---------------------------------------------------------------------------
// macOS — native Squirrel auto-updater via update.electronjs.org
// ---------------------------------------------------------------------------

/** Versions for which the native notification has already been shown this session. */
const notifiedVersions = new Set<string>();

function startMacUpdater(currentVersion: string): void {
  const feedUrl = `https://update.electronjs.org/mischah/syncthis/${process.platform}-${process.arch}/${currentVersion}`;
  autoUpdater.setFeedURL({ url: feedUrl });

  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    const version = (releaseName ?? '').replace(/^v/, '') || 'unknown';
    const info: UpdateInfo = {
      version,
      releaseUrl: `https://github.com/mischah/syncthis/releases/tag/v${version}`,
      publishedAt: new Date().toISOString(),
      downloaded: true,
    };

    broadcastUpdate(info);

    if (!notifiedVersions.has(version)) {
      notifiedVersions.add(version);
      new Notification({
        title: 'syncthis update ready',
        body: `Version ${version} has been downloaded. Restart to update.`,
      }).show();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] autoUpdater error:', err.message);
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Linux — GitHub API polling (autoUpdater not supported)
// ---------------------------------------------------------------------------

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/mischah/syncthis/releases/latest';

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map(Number);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const response = await net.fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      tag_name: string;
      html_url: string;
      published_at: string;
    };
    const version = data.tag_name.replace(/^v/, '');
    if (compareSemver(version, currentVersion) <= 0) return null;
    return { version, releaseUrl: data.html_url, publishedAt: data.published_at };
  } catch {
    return null;
  }
}

function startLinuxUpdater(currentVersion: string): void {
  const check = async () => {
    const info = await checkForUpdate(currentVersion);
    if (!info) return;

    const settings = await loadAppSettings();
    if (settings.dismissedUpdateVersion === info.version) return;

    broadcastUpdate(info);

    if (!notifiedVersions.has(info.version)) {
      notifiedVersions.add(info.version);
      const notification = new Notification({
        title: 'syncthis update available',
        body: `Version ${info.version} is available.`,
      });
      notification.on('click', () => {
        openReleasePage(info.releaseUrl);
      });
      notification.show();
    }
  };

  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startUpdateChecker(currentVersion: string): void {
  if (process.platform === 'darwin') {
    startMacUpdater(currentVersion);
  } else {
    startLinuxUpdater(currentVersion);
  }
}
