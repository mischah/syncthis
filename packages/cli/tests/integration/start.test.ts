import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// tsx is hoisted to the workspace root node_modules
const TSX_BIN = join(__dirname, '../../../../node_modules/.bin/tsx');
const CLI_PATH = join(__dirname, '../../src/cli.ts');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

let tempDir: string;
let workDir: string;
let remoteDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-start-'));
  workDir = join(tempDir, 'work');
  remoteDir = join(tempDir, 'remote.git');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Run a git command via execa, using GIT_ENV for identity-sensitive steps. */
async function git(args: string[], extraEnv?: Record<string, string>): Promise<{ stdout: string }> {
  return execa('git', args, {
    env: { ...process.env, ...GIT_ENV, ...extraEnv },
  });
}

async function setupGitRepoWithRemote(): Promise<void> {
  await mkdir(workDir, { recursive: true });

  // Bare remote
  await git(['init', '--bare', remoteDir]);

  // Work repo with explicit branch name (avoids master/main ambiguity)
  await git(['-C', workDir, 'init', '-b', 'main']);
  await git(['-C', workDir, 'config', 'user.name', 'Test User']);
  await git(['-C', workDir, 'config', 'user.email', 'test@example.com']);
  await git(['-C', workDir, 'remote', 'add', 'origin', `file://${remoteDir}`]);

  // Write .syncthis.json – use minimum allowed interval (10s);
  // the initial sync (runs immediately on startup) picks up the pre-created file.
  const config = {
    remote: `file://${remoteDir}`,
    branch: 'main',
    cron: null,
    interval: 10,
  };
  await writeFile(join(workDir, '.syncthis.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(join(workDir, '.gitignore'), '.syncthis.lock\n.syncthis/\n', 'utf8');

  // Initial commit and push to establish the remote branch
  await git(['-C', workDir, 'add', '-A']);
  await git(['-C', workDir, 'commit', '-m', 'chore: initial setup']);
  await git(['-C', workDir, 'push', '-u', 'origin', 'main']);
}

describe('handleStart integration', () => {
  it('syncs a new file to the remote and removes lock on shutdown', async () => {
    await setupGitRepoWithRemote();

    // Create the file BEFORE starting the process so the initial sync picks it up
    await writeFile(join(workDir, 'note.md'), '# My Note\n', 'utf8');

    // Start the sync process as a subprocess via tsx
    const proc = execa(TSX_BIN, [CLI_PATH, 'start', '--path', workDir], {
      env: { ...process.env, ...GIT_ENV },
      reject: false,
    });

    // Wait for subprocess startup + initial sync cycle (tsx may take a few seconds to load)
    await new Promise<void>((resolve) => setTimeout(resolve, 8000));

    // Trigger graceful shutdown
    proc.kill('SIGTERM');

    // Wait for process to finish
    await proc;

    // A sync commit must exist in the remote (use --all since bare repo HEAD is 'master')
    const { stdout: log } = await git(['-C', remoteDir, 'log', '--all', '--oneline']);
    expect(log).toMatch(/sync: auto-commit/);

    // Lock file must be removed after graceful shutdown
    await expect(access(join(workDir, '.syncthis.lock'))).rejects.toThrow();
  }, 20000);
});
