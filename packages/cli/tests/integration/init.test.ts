import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInit } from '../../src/commands/init.js';

// Prevent process.exit from killing the vitest process
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code ?? 0})`);
});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  mockExit.mockRestore();
  mockConsoleError.mockRestore();
});

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-init-'));
  mockExit.mockClear();
  mockConsoleError.mockClear();
  // Provide git identity via env so commits succeed without global git config
  process.env.GIT_AUTHOR_NAME = 'Test User';
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
  process.env.GIT_COMMITTER_NAME = 'Test User';
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  process.env.GIT_AUTHOR_NAME = undefined;
  process.env.GIT_AUTHOR_EMAIL = undefined;
  process.env.GIT_COMMITTER_NAME = undefined;
  process.env.GIT_COMMITTER_EMAIL = undefined;
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('handleInit --remote', () => {
  it('initializes git repo, configures remote, creates .syncthis.json and .gitignore', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    await handleInit({ path: workDir, remote: `file://${remoteDir}` });

    const git = simpleGit(workDir);

    // Git repo initialized
    await expect(git.raw(['rev-parse', '--git-dir'])).resolves.toBeTruthy();

    // Remote 'origin' configured with correct URL
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    expect(origin?.refs.fetch).toBe(`file://${remoteDir}`);

    // .syncthis.json exists
    expect(await fileExists(join(workDir, '.syncthis.json'))).toBe(true);

    // .gitignore exists and contains syncthis + Obsidian defaults
    expect(await fileExists(join(workDir, '.gitignore'))).toBe(true);
    const gitignore = await readFile(join(workDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.syncthis.lock');
    expect(gitignore).toContain('.syncthis/');
    expect(gitignore).toContain('.obsidian/workspace.json');
  });

  it('sets the git branch to main by default', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    await handleInit({ path: workDir, remote: `file://${remoteDir}` });

    const branch = await simpleGit(workDir).revparse(['--abbrev-ref', 'HEAD']);
    expect(branch.trim()).toBe('main');
  });

  it('sets the git branch to the configured --branch value', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    await handleInit({ path: workDir, remote: `file://${remoteDir}`, branch: 'trunk' });

    const branch = await simpleGit(workDir).revparse(['--abbrev-ref', 'HEAD']);
    expect(branch.trim()).toBe('trunk');
  });

  it('pushes the initial commit and sets the upstream tracking branch', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    await handleInit({ path: workDir, remote: `file://${remoteDir}` });

    // origin/main must exist (push happened)
    const remoteGit = simpleGit(remoteDir);
    const refs = await remoteGit.raw(['show-ref', '--heads']);
    expect(refs).toContain('refs/heads/main');

    // Local branch must track origin/main
    const upstream = await simpleGit(workDir).raw([
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}',
    ]);
    expect(upstream.trim()).toBe('origin/main');
  });

  it('rejects a second init with exit code 1 and a clear error message', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    // First init succeeds
    await handleInit({ path: workDir, remote: `file://${remoteDir}` });

    // Second init must throw (mocked process.exit throws)
    await expect(handleInit({ path: workDir, remote: `file://${remoteDir}` })).rejects.toThrow(
      'process.exit(1)',
    );
    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
  });
});

describe('handleInit --clone', () => {
  it('clones a repo and creates .syncthis.json', async () => {
    // Create a seed repo with an initial commit, then make a bare clone as remote
    const seedDir = join(tempDir, 'seed');
    const remoteDir = join(tempDir, 'remote.git');
    const cloneDir = join(tempDir, 'cloned');

    await mkdir(seedDir, { recursive: true });
    const seedGit = simpleGit(seedDir);
    await seedGit.raw(['init', '-b', 'main']);
    await seedGit.addConfig('user.name', 'Test');
    await seedGit.addConfig('user.email', 'test@test.com');
    await writeFile(join(seedDir, 'README.md'), '# repo\n', 'utf8');
    await seedGit.add(['-A']);
    await seedGit.commit('initial commit');
    await simpleGit().raw(['clone', '--bare', seedDir, remoteDir]);

    await handleInit({ path: cloneDir, clone: `file://${remoteDir}` });

    // Cloned repo is a valid git repo
    const git = simpleGit(cloneDir);
    await expect(git.raw(['rev-parse', '--git-dir'])).resolves.toBeTruthy();

    // .syncthis.json exists and records the correct remote
    expect(await fileExists(join(cloneDir, '.syncthis.json'))).toBe(true);
    const config = JSON.parse(await readFile(join(cloneDir, '.syncthis.json'), 'utf8'));
    expect(config.remote).toBe(`file://${remoteDir}`);
  });
});
