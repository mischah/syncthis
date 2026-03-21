import type { UpdateInfo } from '@syncthis/shared';
import { BrowserWindow, Notification, net, shell } from 'electron';
import { loadAppSettings } from './app-settings.js';

export type { UpdateInfo };

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/mischah/syncthis/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Versions for which the native notification has already been shown this session. */
const notifiedVersions = new Set<string>();

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

export function openReleasePage(url: string): void {
  void shell.openExternal(url);
}

function broadcastUpdateAvailable(info: UpdateInfo): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:available', info);
  }
}

export function startUpdateChecker(currentVersion: string): void {
  const check = async () => {
    const info = await checkForUpdate(currentVersion);
    if (!info) return;

    const settings = await loadAppSettings();
    if (settings.dismissedUpdateVersion === info.version) return;

    broadcastUpdateAvailable(info);

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
