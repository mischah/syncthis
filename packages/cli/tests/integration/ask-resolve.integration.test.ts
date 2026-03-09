import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleResolve } from '../../src/commands/resolve.js';
import type { SyncthisConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { runSyncCycle } from '../../src/sync.js';

// ---------------------------------------------------------------------------
// Mocks — @clack/prompts for automatic answers
// ---------------------------------------------------------------------------

const mockSelect = vi.hoisted(() => vi.fn());
const mockIsCancel = vi.hoisted(() => vi.fn());

vi.mock('@clack/prompts', () => ({
  select: mockSelect,
  intro: vi.fn(),
  outro: vi.fn(),
  log: { step: vi.fn() },
  isCancel: mockIsCancel,
}));

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCancel.mockReturnValue(false);
});

async function runGit(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await execa('git', ['-C', cwd, ...args], {
    env: { ...process.env, ...GIT_ENV, ...env },
  });
  return result.stdout;
}

async function setupIdentity(dir: string): Promise<void> {
  await runGit(dir, ['config', 'user.name', 'Test User']);
  await runGit(dir, ['config', 'user.email', 'test@example.com']);
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);
  await runGit(dir, ['config', 'core.editor', ':']);
}

async function initBareRemote(remote: string): Promise<void> {
  await execa('git', ['init', '--bare', remote]);
  await execa('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
}

async function cloneRepo(remote: string, dest: string): Promise<void> {
  await execa('git', ['clone', '--branch', 'main', `file://${remote}`, dest]);
}

interface TestSetup {
  remote: string;
  clientA: string;
  clientB: string;
  tempDir: string;
}

async function createTestSetupWithFiles(initialFiles: string[]): Promise<TestSetup> {
  const tempDir = await mkdtemp(join(tmpdir(), 'syncthis-ask-'));
  tempDirs.push(tempDir);

  const remote = join(tempDir, 'remote.git');
  const clientA = join(tempDir, 'clientA');
  const clientB = join(tempDir, 'clientB');

  await initBareRemote(remote);

  const seed = join(tempDir, 'seed');
  await mkdir(seed);
  await runGit(seed, ['-c', 'init.defaultBranch=main', 'init']);
  await setupIdentity(seed);
  await runGit(seed, ['remote', 'add', 'origin', `file://${remote}`]);

  for (const filename of initialFiles) {
    await writeFile(join(seed, filename), 'initial content\n');
  }
  await runGit(seed, ['add', '-A']);
  await runGit(seed, ['commit', '-m', 'initial']);
  await runGit(seed, ['push', '-u', 'origin', 'main']);

  await cloneRepo(remote, clientA);
  await cloneRepo(remote, clientB);
  await setupIdentity(clientA);
  await setupIdentity(clientB);

  return { remote, clientA, clientB, tempDir };
}

async function createTestSetup(): Promise<TestSetup> {
  return createTestSetupWithFiles(['note.md']);
}

async function createConflict(
  clientA: string,
  clientB: string,
  filename: string,
  contentA: string,
  contentB: string,
): Promise<void> {
  // Client A: modify file, commit, push
  await writeFile(join(clientA, filename), contentA);
  await runGit(clientA, ['add', '-A']);
  await runGit(clientA, ['commit', '-m', `Client A: ${filename}`]);
  await runGit(clientA, ['push', 'origin', 'main']);

  // Client B: modify same file, commit (don't push) — creates divergence
  await writeFile(join(clientB, filename), contentB);
  await runGit(clientB, ['add', '-A']);
  await runGit(clientB, ['commit', '-m', `Client B: ${filename}`]);
}

function makeConfig(
  remote: string,
  onConflict: SyncthisConfig['onConflict'] = 'ask',
): SyncthisConfig {
  return { remote: `file://${remote}`, branch: 'main', cron: null, interval: 30, onConflict };
}

function setTTY(value: true | false | undefined): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ask-resolve integration tests', () => {
  it('ask + local: --ours (A) version kept, pushed to remote', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    setTTY(true);
    mockSelect.mockResolvedValueOnce('local');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('synced');
    expect(mockSelect).toHaveBeenCalledOnce();

    // 'local' → checkout --ours → A's version (upstream HEAD during rebase)
    const content = await readFile(join(s.clientB, 'note.md'), 'utf8');
    expect(content).toBe('Client A version\n');

    // Remote should also have A's version after push
    const verifyDir = join(s.tempDir, 'verify');
    await cloneRepo(s.remote, verifyDir);
    expect(await readFile(join(verifyDir, 'note.md'), 'utf8')).toBe('Client A version\n');
  }, 20000);

  it('ask + remote: --theirs (B) version wins, pushed to remote', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    setTTY(true);
    mockSelect.mockResolvedValueOnce('remote');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('synced');

    // 'remote' → checkout --theirs → B's version (REBASE_HEAD during rebase)
    const content = await readFile(join(s.clientB, 'note.md'), 'utf8');
    expect(content).toBe('Client B version\n');

    const verifyDir = join(s.tempDir, 'verify');
    await cloneRepo(s.remote, verifyDir);
    expect(await readFile(join(verifyDir, 'note.md'), 'utf8')).toBe('Client B version\n');
  }, 20000);

  it('ask + both: local (B) kept in original, remote (A) saved as conflict copy', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    setTTY(true);
    mockSelect.mockResolvedValueOnce('both');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('synced');
    expect(result.conflictCopies).toHaveLength(1);

    // Original file keeps local (B) version
    const content = await readFile(join(s.clientB, 'note.md'), 'utf8');
    expect(content).toBe('Client B version\n');

    // Conflict copy contains remote (A) version
    const copyPath = result.conflictCopies?.[0] ?? '';
    expect(copyPath).toMatch(/\.conflict-\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(join(s.clientB, copyPath))).toBe(true);
    expect(await readFile(join(s.clientB, copyPath), 'utf8')).toBe('Client A version\n');
  }, 20000);

  it('ask + abort: rebase aborted, working directory restored to pre-pull state', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    setTTY(true);
    mockSelect.mockResolvedValueOnce('abort');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('conflict');

    // Rebase should be fully aborted
    expect(existsSync(join(s.clientB, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(s.clientB, '.git', 'rebase-apply'))).toBe(false);

    // Working directory back to Client B's original state
    expect(await readFile(join(s.clientB, 'note.md'), 'utf8')).toBe('Client B version\n');
  }, 20000);

  it('ask + mixed decisions: 3 files each resolved differently', async () => {
    const s = await createTestSetupWithFiles(['file1.md', 'file2.md', 'file3.md']);

    // Client A: modify all 3 files in one commit, push
    for (const name of ['file1.md', 'file2.md', 'file3.md']) {
      await writeFile(join(s.clientA, name), `Client A: ${name}\n`);
    }
    await runGit(s.clientA, ['add', '-A']);
    await runGit(s.clientA, ['commit', '-m', 'A changes all files']);
    await runGit(s.clientA, ['push', 'origin', 'main']);

    // Client B: modify all 3 files in one commit (don't push)
    for (const name of ['file1.md', 'file2.md', 'file3.md']) {
      await writeFile(join(s.clientB, name), `Client B: ${name}\n`);
    }
    await runGit(s.clientB, ['add', '-A']);
    await runGit(s.clientB, ['commit', '-m', 'B changes all files']);

    setTTY(true);
    // file1 → local (B), file2 → remote (A), file3 → both
    // git diff --name-only returns files alphabetically: file1, file2, file3
    mockSelect
      .mockResolvedValueOnce('local')
      .mockResolvedValueOnce('remote')
      .mockResolvedValueOnce('both');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('synced');
    expect(mockSelect).toHaveBeenCalledTimes(3);

    // file1: 'local' → --ours → A's version
    expect(await readFile(join(s.clientB, 'file1.md'), 'utf8')).toBe('Client A: file1.md\n');
    // file2: 'remote' → --theirs → B's version
    expect(await readFile(join(s.clientB, 'file2.md'), 'utf8')).toBe('Client B: file2.md\n');
    // file3: 'both' → --theirs (B) in original, HEAD (A) as conflict copy
    expect(await readFile(join(s.clientB, 'file3.md'), 'utf8')).toBe('Client B: file3.md\n');
    expect(result.conflictCopies).toHaveLength(1);
    const copies = result.conflictCopies ?? [];
    const copy = copies[0] ?? '';
    expect(copy).toContain('file3');
    expect(await readFile(join(s.clientB, copy), 'utf8')).toBe('Client A: file3.md\n');
  }, 25000);

  it('abort mid-resolution: file 1 resolved, abort at file 2 → entire rebase aborted', async () => {
    const s = await createTestSetupWithFiles(['file1.md', 'file2.md', 'file3.md']);

    for (const name of ['file1.md', 'file2.md', 'file3.md']) {
      await writeFile(join(s.clientA, name), `Client A: ${name}\n`);
    }
    await runGit(s.clientA, ['add', '-A']);
    await runGit(s.clientA, ['commit', '-m', 'A changes all files']);
    await runGit(s.clientA, ['push', 'origin', 'main']);

    for (const name of ['file1.md', 'file2.md', 'file3.md']) {
      await writeFile(join(s.clientB, name), `Client B: ${name}\n`);
    }
    await runGit(s.clientB, ['add', '-A']);
    await runGit(s.clientB, ['commit', '-m', 'B changes all files']);

    setTTY(true);
    // file1 → local, file2 → abort (stops the entire rebase)
    mockSelect.mockResolvedValueOnce('local').mockResolvedValueOnce('abort');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('conflict');

    // Rebase fully aborted (git rebase --abort undoes even resolved file1)
    expect(existsSync(join(s.clientB, '.git', 'rebase-merge'))).toBe(false);

    // All files back to Client B's original versions
    for (const name of ['file1.md', 'file2.md', 'file3.md']) {
      expect(await readFile(join(s.clientB, name), 'utf8')).toBe(`Client B: ${name}\n`);
    }
  }, 25000);

  it('resolve standalone: handleResolve resolves an existing rebase conflict', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    // Trigger the rebase conflict directly (no auto-commit, so .syncthis.json stays untracked)
    await runGit(s.clientB, ['pull', '--rebase', 'origin', 'main']).catch(() => {});
    expect(
      existsSync(join(s.clientB, '.git', 'rebase-merge')) ||
        existsSync(join(s.clientB, '.git', 'rebase-apply')),
    ).toBe(true);

    // Write .syncthis.json as untracked file — survives while rebase is paused
    await writeFile(
      join(s.clientB, '.syncthis.json'),
      JSON.stringify({ remote: `file://${s.remote}`, branch: 'main', interval: 30 }),
    );

    // User runs 'syncthis resolve' (with TTY) — selects 'local' → --ours → A's version
    setTTY(true);
    mockSelect.mockResolvedValueOnce('local');

    await handleResolve({ path: s.clientB });

    // Rebase done
    expect(existsSync(join(s.clientB, '.git', 'rebase-merge'))).toBe(false);

    // 'local' → --ours → A's version
    expect(await readFile(join(s.clientB, 'note.md'), 'utf8')).toBe('Client A version\n');

    // Pushed to remote
    const verifyDir = join(s.tempDir, 'verify');
    await cloneRepo(s.remote, verifyDir);
    expect(await readFile(join(verifyDir, 'note.md'), 'utf8')).toBe('Client A version\n');
  }, 25000);

  it('non-TTY fallback: ask → stop behavior, next sync skips, then resolves via handleResolve', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    // Non-TTY: process.stdin.isTTY = undefined
    setTTY(undefined);

    const result1 = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);
    expect(result1.status).toBe('conflict');
    expect(result1.error).toBe('Awaiting interactive resolution');
    expect(mockSelect).not.toHaveBeenCalled();

    // Rebase still in progress
    expect(
      existsSync(join(s.clientB, '.git', 'rebase-merge')) ||
        existsSync(join(s.clientB, '.git', 'rebase-apply')),
    ).toBe(true);

    // Write .syncthis.json now — untracked files survive while rebase is paused
    await writeFile(
      join(s.clientB, '.syncthis.json'),
      JSON.stringify({
        remote: `file://${s.remote}`,
        branch: 'main',
        interval: 30,
        onConflict: 'ask',
      }),
    );

    // Next sync cycle: detects open rebase, skips
    const result2 = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);
    expect(result2.status).toBe('conflict');
    expect(result2.error).toBe('Rebase in progress');

    // User runs handleResolve (with TTY)
    setTTY(true);
    mockSelect.mockResolvedValueOnce('local');
    await handleResolve({ path: s.clientB });

    // Rebase resolved
    expect(existsSync(join(s.clientB, '.git', 'rebase-merge'))).toBe(false);

    // Next sync cycle: no conflict, normal operation
    const result3 = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);
    expect(result3.status).not.toBe('conflict');
  }, 30000);

  it('cascading rebase: B has 2 commits, A has 2 conflicting commits → 2 resolution rounds', async () => {
    const s = await createTestSetupWithFiles(['file1.md', 'file2.md']);

    // Client A: two separate commits on different files, both pushed
    await writeFile(join(s.clientA, 'file1.md'), 'A version of file1\n');
    await runGit(s.clientA, ['add', '-A']);
    await runGit(s.clientA, ['commit', '-m', 'A: change file1']);
    await runGit(s.clientA, ['push', 'origin', 'main']);

    await writeFile(join(s.clientA, 'file2.md'), 'A version of file2\n');
    await runGit(s.clientA, ['add', '-A']);
    await runGit(s.clientA, ['commit', '-m', 'A: change file2']);
    await runGit(s.clientA, ['push', 'origin', 'main']);

    // Client B: two commits touching the same files (not pushed)
    await writeFile(join(s.clientB, 'file1.md'), 'B version of file1\n');
    await runGit(s.clientB, ['add', '-A']);
    await runGit(s.clientB, ['commit', '-m', 'B: change file1']);

    await writeFile(join(s.clientB, 'file2.md'), 'B version of file2\n');
    await runGit(s.clientB, ['add', '-A']);
    await runGit(s.clientB, ['commit', '-m', 'B: change file2']);

    setTTY(true);
    // Round 1: conflict on file1 → local (B)
    // Round 2: conflict on file2 → local (B)
    mockSelect.mockResolvedValueOnce('local').mockResolvedValueOnce('local');

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('synced');
    expect(mockSelect).toHaveBeenCalledTimes(2);

    // 'local' → --ours → A's version for both files
    expect(await readFile(join(s.clientB, 'file1.md'), 'utf8')).toBe('A version of file1\n');
    expect(await readFile(join(s.clientB, 'file2.md'), 'utf8')).toBe('A version of file2\n');

    // Verify pushed to remote
    const verifyDir = join(s.tempDir, 'verify');
    await cloneRepo(s.remote, verifyDir);
    expect(await readFile(join(verifyDir, 'file1.md'), 'utf8')).toBe('A version of file1\n');
    expect(await readFile(join(verifyDir, 'file2.md'), 'utf8')).toBe('A version of file2\n');
  }, 30000);

  it('ctrl+c simulation: isCancel=true → rebase aborted, working directory clean', async () => {
    const s = await createTestSetup();
    await createConflict(
      s.clientA,
      s.clientB,
      'note.md',
      'Client A version\n',
      'Client B version\n',
    );

    setTTY(true);
    const cancelSymbol = Symbol('cancel');
    mockSelect.mockResolvedValueOnce(cancelSymbol);
    mockIsCancel.mockReturnValueOnce(true);

    const result = await runSyncCycle(s.clientB, makeConfig(s.remote), noopLogger);

    expect(result.status).toBe('conflict');

    // Rebase aborted
    expect(existsSync(join(s.clientB, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(s.clientB, '.git', 'rebase-apply'))).toBe(false);

    // Working directory restored to Client B's state
    expect(await readFile(join(s.clientB, 'note.md'), 'utf8')).toBe('Client B version\n');
  }, 20000);
});
