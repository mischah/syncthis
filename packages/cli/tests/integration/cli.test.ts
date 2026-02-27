import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import simpleGit from 'simple-git';
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

function runCli(
  args: string[],
  options: { env?: Record<string, string> } = {},
): ReturnType<typeof execa> {
  return execa(TSX_BIN, [CLI_PATH, ...args], {
    reject: false,
    env: options.env !== undefined ? { ...process.env, ...options.env } : undefined,
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'syncthis-cli-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('--help', () => {
  it('prints help text and exits with code 0', async () => {
    const result = await runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('syncthis');
    expect(result.stdout).toContain('init');
    expect(result.stdout).toContain('start');
    expect(result.stdout).toContain('status');
  });
});

describe('--version', () => {
  it('prints a semver version and exits with code 0', async () => {
    const result = await runCli(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('no command', () => {
  it('shows help text when invoked without arguments', async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('syncthis');
  });
});

describe('unknown command', () => {
  it('reports an error and exits with a non-zero code', async () => {
    const result = await runCli(['unknowncommand']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown command 'unknowncommand'");
  });
});

describe('init command', () => {
  it('initializes a directory via --remote and exits with code 0', async () => {
    const remoteDir = join(tempDir, 'remote.git');
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    await simpleGit().raw(['init', '--bare', remoteDir]);

    const result = await runCli(['init', '--remote', `file://${remoteDir}`, '--path', workDir], {
      env: GIT_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Initialized syncthis');
  });
});

describe('start command', () => {
  it('exits with non-zero and hints at init when .syncthis.json is missing', async () => {
    const result = await runCli(['start', '--path', tempDir]);
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/init/i);
  });
});

describe('status command', () => {
  it('shows "Not initialized" when no .syncthis.json exists', async () => {
    const result = await runCli(['status', '--path', tempDir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Not initialized');
  });
});

describe('daemon command', () => {
  it('reports an error and exits with non-zero when no subcommand is given', async () => {
    const result = await runCli(['daemon']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No daemon subcommand provided');
  });

  it('exits with non-zero and hints at init when .syncthis.json is missing', async () => {
    const result = await runCli(['daemon', 'start', '--path', tempDir]);
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/init/i);
  });
});
