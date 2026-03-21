import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import simpleGit, { type SimpleGit } from 'simple-git';

const execFileAsync = promisify(execFile);

interface GitProviderState {
  binaryPath: string;
  env: Record<string, string>;
  source: 'system' | 'bundled';
}

let state: GitProviderState | null = null;

export async function initGitProvider(): Promise<void> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000 });
    state = { binaryPath: 'git', env: {}, source: 'system' };
    console.log('[git-provider] Using system git');
    return;
  } catch {
    // System git not available — fall back to dugite
  }

  const { setupEnvironment } = await import('dugite');
  const result = setupEnvironment({});
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  state = { binaryPath: result.gitLocation, env, source: 'bundled' };
  console.log(`[git-provider] Using bundled git at ${result.gitLocation}`);
}

export function getGitSource(): 'system' | 'bundled' {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.source;
}

export function getGitBinaryPath(): string {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.binaryPath;
}

export function getGitBinDir(): string {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.source === 'bundled' ? dirname(state.binaryPath) : '';
}

export function getGitEnv(): Record<string, string> {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  return state.env;
}

export function getSimpleGit(dirPath: string): SimpleGit {
  if (!state) throw new Error('Git provider not initialized. Call initGitProvider() first.');
  const git = simpleGit(dirPath, { binary: state.binaryPath });
  if (state.source === 'bundled') {
    git.env(state.env);
  }
  return git;
}
