import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { JsonOutput } from '@syncthis/shared';

const execFileAsync = promisify(execFile);
const CLI_BIN = join(homedir(), '.syncthis', 'bin', 'syncthis');

export async function runCli(args: string[]): Promise<JsonOutput> {
  try {
    const { stdout } = await execFileAsync(CLI_BIN, [...args, '--json']);
    return JSON.parse(stdout) as JsonOutput;
  } catch (err: unknown) {
    const error = err as { stdout?: string; message?: string };
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout) as JsonOutput;
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      command: args[0] ?? 'unknown',
      error: { message: error.message ?? String(err) },
    };
  }
}

export async function startService(dirPath: string): Promise<JsonOutput> {
  return runCli(['start', '--path', dirPath]);
}

export async function stopService(dirPath: string): Promise<JsonOutput> {
  return runCli(['stop', '--path', dirPath]);
}
