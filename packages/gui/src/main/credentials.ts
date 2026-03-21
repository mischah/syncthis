import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getGitBinaryPath, getGitEnv } from './git-provider.js';

const execFileAsync = promisify(execFile);

const CREDENTIALS_DIR = join(homedir(), '.syncthis', 'credentials');

export function folderHash(dirPath: string): string {
  return createHash('sha256').update(dirPath).digest('hex').slice(0, 12);
}

export function getCredentialScriptPath(dirPath: string): string {
  return join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
}

export async function writeCredentialHelper(dirPath: string, token: string): Promise<string> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  const scriptPath = join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
  const content = `#!/bin/sh\necho "username=x-access-token"\necho "password=${token}"\n`;
  await writeFile(scriptPath, content, 'utf8');
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

export async function configureRepoCredentialHelper(
  dirPath: string,
  scriptPath: string,
): Promise<void> {
  await execFileAsync(
    getGitBinaryPath(),
    ['-C', dirPath, 'config', 'credential.helper', `!${scriptPath}`],
    {
      env: { ...process.env, ...getGitEnv() },
    },
  );
}

export async function setupCredentials(dirPath: string, token: string): Promise<void> {
  const scriptPath = await writeCredentialHelper(dirPath, token);
  await configureRepoCredentialHelper(dirPath, scriptPath);
}

export async function removeCredentialHelper(dirPath: string): Promise<void> {
  const scriptPath = join(CREDENTIALS_DIR, `${folderHash(dirPath)}.sh`);
  try {
    await unlink(scriptPath);
  } catch {
    // file may not exist
  }
  try {
    await execFileAsync(
      getGitBinaryPath(),
      ['-C', dirPath, 'config', '--unset', 'credential.helper'],
      {
        env: { ...process.env, ...getGitEnv() },
      },
    );
  } catch {
    // config may not be set
  }
}

export async function updateAllCredentialHelpers(newToken: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(CREDENTIALS_DIR);
  } catch {
    return; // directory doesn't exist yet
  }
  await Promise.all(
    files
      .filter((f) => f.endsWith('.sh'))
      .map(async (f) => {
        const scriptPath = join(CREDENTIALS_DIR, f);
        const content = `#!/bin/sh\necho "username=x-access-token"\necho "password=${newToken}"\n`;
        await writeFile(scriptPath, content, 'utf8');
        await chmod(scriptPath, 0o700);
      }),
  );
}
