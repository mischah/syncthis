import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncthisConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { runSyncCycle } from '../../src/sync.js';

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
  // Prevent global config from blocking commits (GPG signing, interactive editor)
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);
  await runGit(dir, ['config', 'core.editor', ':']);
}

async function initBareRemote(remote: string): Promise<void> {
  await execa('git', ['init', '--bare', remote]);
  // Force HEAD → main (bare init defaults to master on older git)
  await execa('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
}

async function cloneRepo(remote: string, dest: string): Promise<void> {
  await execa('git', ['clone', '--branch', 'main', `file://${remote}`, dest]);
}

interface ConflictScenario {
  clientA: string;
  clientB: string;
  remote: string;
  conflictFile: string;
  tempDir: string;
}

async function createConflictScenario(
  opts: {
    clientADate?: string;
    clientBDate?: string;
  } = {},
): Promise<ConflictScenario> {
  const tempDir = await mkdtemp(join(tmpdir(), 'syncthis-cr-'));
  tempDirs.push(tempDir);

  const remote = join(tempDir, 'remote.git');
  const clientA = join(tempDir, 'clientA');
  const clientB = join(tempDir, 'clientB');
  const conflictFile = 'note.md';

  await initBareRemote(remote);

  // Seed repo: initial commit → push
  const seed = join(tempDir, 'seed');
  await mkdir(seed);
  await runGit(seed, ['-c', 'init.defaultBranch=main', 'init']);
  await setupIdentity(seed);
  await runGit(seed, ['remote', 'add', 'origin', `file://${remote}`]);
  await writeFile(join(seed, conflictFile), 'initial content\n');
  await runGit(seed, ['add', '-A']);
  await runGit(seed, ['commit', '-m', 'initial']);
  await runGit(seed, ['push', '-u', 'origin', 'main']);

  // Clone both clients
  await cloneRepo(remote, clientA);
  await cloneRepo(remote, clientB);
  await setupIdentity(clientA);
  await setupIdentity(clientB);

  // Client A: modify conflictFile, commit with date, push
  const clientADate = opts.clientADate ?? '2025-01-01T10:00:00 +0000';
  await writeFile(join(clientA, conflictFile), 'Client A version\n');
  await runGit(clientA, ['add', '-A']);
  await runGit(clientA, ['commit', '-m', 'Client A change'], {
    GIT_AUTHOR_DATE: clientADate,
    GIT_COMMITTER_DATE: clientADate,
  });
  await runGit(clientA, ['push', 'origin', 'main']);

  // Client B: modify same conflictFile, commit with date (don't push)
  const clientBDate = opts.clientBDate ?? '2025-01-01T12:00:00 +0000';
  await writeFile(join(clientB, conflictFile), 'Client B version\n');
  await runGit(clientB, ['add', '-A']);
  await runGit(clientB, ['commit', '-m', 'Client B change'], {
    GIT_AUTHOR_DATE: clientBDate,
    GIT_COMMITTER_DATE: clientBDate,
  });

  return { clientA, clientB, remote, conflictFile, tempDir };
}

function makeConfig(
  onConflict: 'stop' | 'auto-both' | 'auto-newest',
  remote: string,
): SyncthisConfig {
  return {
    remote,
    branch: 'main',
    cron: null,
    interval: 30,
    onConflict,
  };
}

describe('conflict-resolution integration', () => {
  it('auto-both: keeps local version in original, saves remote version as conflict copy', async () => {
    const s = await createConflictScenario();
    const result = await runSyncCycle(
      s.clientB,
      makeConfig('auto-both', `file://${s.remote}`),
      noopLogger,
    );

    expect(result.status).toBe('synced');
    expect(result.conflictCopies).toHaveLength(1);

    const original = await readFile(join(s.clientB, s.conflictFile), 'utf8');
    expect(original).not.toContain('<<<<<<<');
    expect(original).not.toContain('>>>>>>>');
    // Spec: original file keeps local (Client B) version
    expect(original).toBe('Client B version\n');

    const conflictCopyRel = result.conflictCopies![0];
    expect(existsSync(join(s.clientB, conflictCopyRel))).toBe(true);
    // Conflict copy filename follows schema: <base>.conflict-<timestamp><ext>
    expect(conflictCopyRel).toMatch(/\.conflict-\d{4}-\d{2}-\d{2}T/);
    // Spec: conflict copy contains remote (Client A) version
    const copyContent = await readFile(join(s.clientB, conflictCopyRel), 'utf8');
    expect(copyContent).toBe('Client A version\n');

    // Both files committed and pushed to remote
    const verifyDir = join(s.tempDir, 'verify');
    await cloneRepo(s.remote, verifyDir);
    expect(existsSync(join(verifyDir, s.conflictFile))).toBe(true);
    expect(existsSync(join(verifyDir, conflictCopyRel))).toBe(true);
  }, 15000);

  it('auto-newest: local newer → keeps local version, no conflict copy', async () => {
    const s = await createConflictScenario({
      clientADate: '2025-01-01T10:00:00 +0000', // older
      clientBDate: '2025-01-01T12:00:00 +0000', // newer
    });
    const result = await runSyncCycle(
      s.clientB,
      makeConfig('auto-newest', `file://${s.remote}`),
      noopLogger,
    );

    expect(result.status).toBe('synced');
    expect(result.conflictCopies ?? []).toHaveLength(0);

    const content = await readFile(join(s.clientB, s.conflictFile), 'utf8');
    expect(content).not.toContain('<<<<<<<');
    expect(content).toBe('Client B version\n');
  }, 15000);

  it('auto-newest: remote newer → keeps remote version, no conflict copy', async () => {
    const s = await createConflictScenario({
      clientADate: '2025-01-01T12:00:00 +0000', // newer
      clientBDate: '2025-01-01T10:00:00 +0000', // older
    });
    const result = await runSyncCycle(
      s.clientB,
      makeConfig('auto-newest', `file://${s.remote}`),
      noopLogger,
    );

    expect(result.status).toBe('synced');
    expect(result.conflictCopies ?? []).toHaveLength(0);

    const content = await readFile(join(s.clientB, s.conflictFile), 'utf8');
    expect(content).not.toContain('<<<<<<<');
    expect(content).toBe('Client A version\n');
  }, 15000);

  it('auto-newest: equal timestamps → fallback to auto-both (creates conflict copy)', async () => {
    const sameDate = '2025-01-01T10:00:00 +0000';
    const s = await createConflictScenario({ clientADate: sameDate, clientBDate: sameDate });
    const result = await runSyncCycle(
      s.clientB,
      makeConfig('auto-newest', `file://${s.remote}`),
      noopLogger,
    );

    expect(result.status).toBe('synced');
    expect(result.conflictCopies).toHaveLength(1);

    const original = await readFile(join(s.clientB, s.conflictFile), 'utf8');
    expect(original).not.toContain('<<<<<<<');
  }, 15000);

  it('stop: leaves rebase in progress on conflict', async () => {
    const s = await createConflictScenario();
    const result = await runSyncCycle(
      s.clientB,
      makeConfig('stop', `file://${s.remote}`),
      noopLogger,
    );

    expect(result.status).toBe('conflict');
    const rebaseInProgress =
      existsSync(join(s.clientB, '.git', 'rebase-merge')) ||
      existsSync(join(s.clientB, '.git', 'rebase-apply'));
    expect(rebaseInProgress).toBe(true);
  }, 15000);

  it('auto-both: multiple files in conflict → one conflict copy per file, all pushed to remote', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'syncthis-cr-'));
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
    await writeFile(join(seed, 'file1.md'), 'file1 initial\n');
    await writeFile(join(seed, 'file2.md'), 'file2 initial\n');
    await runGit(seed, ['add', '-A']);
    await runGit(seed, ['commit', '-m', 'initial']);
    await runGit(seed, ['push', '-u', 'origin', 'main']);

    await cloneRepo(remote, clientA);
    await cloneRepo(remote, clientB);
    await setupIdentity(clientA);
    await setupIdentity(clientB);

    await writeFile(join(clientA, 'file1.md'), 'file1 A\n');
    await writeFile(join(clientA, 'file2.md'), 'file2 A\n');
    await runGit(clientA, ['add', '-A']);
    await runGit(clientA, ['commit', '-m', 'A changes']);
    await runGit(clientA, ['push', 'origin', 'main']);

    await writeFile(join(clientB, 'file1.md'), 'file1 B\n');
    await writeFile(join(clientB, 'file2.md'), 'file2 B\n');
    await runGit(clientB, ['add', '-A']);
    await runGit(clientB, ['commit', '-m', 'B changes']);

    const result = await runSyncCycle(
      clientB,
      makeConfig('auto-both', `file://${remote}`),
      noopLogger,
    );

    expect(result.status).toBe('synced');
    expect(result.conflictCopies).toHaveLength(2);

    const f1 = await readFile(join(clientB, 'file1.md'), 'utf8');
    const f2 = await readFile(join(clientB, 'file2.md'), 'utf8');
    expect(f1).not.toContain('<<<<<<<');
    expect(f2).not.toContain('<<<<<<<');

    for (const copy of result.conflictCopies!) {
      expect(existsSync(join(clientB, copy))).toBe(true);
    }

    // All 4 files present in remote after push
    const verifyDir = join(tempDir, 'verify');
    await cloneRepo(remote, verifyDir);
    for (const copy of result.conflictCopies!) {
      expect(existsSync(join(verifyDir, copy))).toBe(true);
    }
  }, 20000);

  it('no conflict: different files changed on each client → no conflict copies', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'syncthis-cr-'));
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
    await writeFile(join(seed, 'fileX.md'), 'X initial\n');
    await writeFile(join(seed, 'fileY.md'), 'Y initial\n');
    await runGit(seed, ['add', '-A']);
    await runGit(seed, ['commit', '-m', 'initial']);
    await runGit(seed, ['push', '-u', 'origin', 'main']);

    await cloneRepo(remote, clientA);
    await cloneRepo(remote, clientB);
    await setupIdentity(clientA);
    await setupIdentity(clientB);

    // Client A changes fileX only
    await writeFile(join(clientA, 'fileX.md'), 'X from A\n');
    await runGit(clientA, ['add', '-A']);
    await runGit(clientA, ['commit', '-m', 'A changes X']);
    await runGit(clientA, ['push', 'origin', 'main']);

    // Client B changes fileY only (different file → no conflict)
    await writeFile(join(clientB, 'fileY.md'), 'Y from B\n');
    await runGit(clientB, ['add', '-A']);
    await runGit(clientB, ['commit', '-m', 'B changes Y']);

    const result = await runSyncCycle(
      clientB,
      makeConfig('auto-both', `file://${remote}`),
      noopLogger,
    );

    expect(result.status).not.toBe('conflict');
    expect(result.conflictCopies ?? []).toHaveLength(0);
  }, 15000);
});
