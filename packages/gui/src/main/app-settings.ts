import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppSettings } from '@syncthis/shared';
import { app } from 'electron';

const DEFAULT_SETTINGS: AppSettings = {
  launchOnLogin: false,
  defaults: {
    interval: 300, // 5 minutes
    onConflict: 'auto-both',
  },
  github: {},
};

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const content = await readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(content) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      defaults: { ...DEFAULT_SETTINGS.defaults, ...parsed.defaults },
      github: { ...DEFAULT_SETTINGS.github, ...parsed.github },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults }, github: {} };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
