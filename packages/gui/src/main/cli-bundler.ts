import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

const INSTALL_DIR = join(homedir(), '.syncthis', 'bin');
const INSTALL_PATH = join(INSTALL_DIR, 'syncthis');

export async function ensureCliBundled(): Promise<void> {
  await mkdir(INSTALL_DIR, { recursive: true });

  const source = app.isPackaged
    ? join(process.resourcesPath, 'dist', 'cli.js')
    : join(__dirname, '..', '..', '..', 'cli', 'dist', 'cli.js');

  const escaped = source.replace(/'/g, "\\'");
  const wrapper = `#!/usr/bin/env node\nimport('${escaped}');\n`;
  await writeFile(INSTALL_PATH, wrapper, 'utf8');
  await chmod(INSTALL_PATH, 0o755);
}
