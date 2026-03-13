import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAccess = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockReaddir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  readdir: mockReaddir,
  writeFile: mockWriteFile,
}));

const mockGit = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue(''),
  addRemote: vi.fn().mockResolvedValue(undefined),
  getRemotes: vi.fn().mockResolvedValue([]),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  clone: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('simple-git', () => ({ default: vi.fn(() => mockGit) }));

const mockCreateDefaultConfig = vi.hoisted(() => vi.fn(() => ({ remote: 'r', branch: 'main' })));
const mockWriteConfig = vi.hoisted(() => vi.fn());
vi.mock('../../src/config.js', () => ({
  createDefaultConfig: mockCreateDefaultConfig,
  writeConfig: mockWriteConfig,
}));

const mockPrintJson = vi.hoisted(() => vi.fn());
const mockPrintJsonError = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('printJsonError');
  }),
);
vi.mock('../../src/json-output.js', () => ({
  printJson: mockPrintJson,
  printJsonError: mockPrintJsonError,
}));

import { handleInit } from '../../src/commands/init.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  // Default: .syncthis.json does not exist
  mockAccess.mockRejectedValue(new Error('ENOENT'));
});

// ---------------------------------------------------------------------------
// Flag validation
// ---------------------------------------------------------------------------

describe('flag validation', () => {
  it('rejects when both --remote and --clone are given', async () => {
    await expect(handleInit({ path: '/dir', remote: 'url', clone: 'url' })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
  });

  it('rejects when both --remote and --clone are given (json mode)', async () => {
    await expect(
      handleInit({ path: '/dir', remote: 'url', clone: 'url', json: true }),
    ).rejects.toThrow('printJsonError');

    expect(mockPrintJsonError).toHaveBeenCalledWith(
      'init',
      '--remote and --clone are mutually exclusive.',
      'INVALID_FLAGS',
    );
  });

  it('rejects when neither --remote nor --clone is given', async () => {
    await expect(handleInit({ path: '/dir' })).rejects.toThrow('process.exit(1)');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('One of --remote or --clone'));
  });

  it('rejects when neither flag is given (json mode)', async () => {
    await expect(handleInit({ path: '/dir', json: true })).rejects.toThrow('printJsonError');

    expect(mockPrintJsonError).toHaveBeenCalledWith(
      'init',
      'One of --remote or --clone is required.',
      'INVALID_FLAGS',
    );
  });
});

// ---------------------------------------------------------------------------
// handleInitRemote
// ---------------------------------------------------------------------------

describe('handleInitRemote', () => {
  it('errors when already initialized', async () => {
    mockAccess.mockResolvedValue(undefined); // .syncthis.json exists

    await expect(handleInit({ path: '/dir', remote: 'git@host:repo.git' })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
  });

  it('errors when already initialized (json mode)', async () => {
    mockAccess.mockResolvedValue(undefined);

    await expect(
      handleInit({ path: '/dir', remote: 'git@host:repo.git', json: true }),
    ).rejects.toThrow('printJsonError');

    expect(mockPrintJsonError).toHaveBeenCalledWith(
      'init',
      'Already initialized (.syncthis.json exists).',
      'ALREADY_INITIALIZED',
    );
  });

  it('initializes git repo when directory is not a repo', async () => {
    mockGit.raw
      .mockRejectedValueOnce(new Error('not a repo')) // rev-parse --git-dir
      .mockResolvedValueOnce(undefined) // symbolic-ref HEAD
      .mockResolvedValueOnce(''); // status --porcelain (no files)

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(mockGit.init).toHaveBeenCalled();
    expect(mockGit.addRemote).toHaveBeenCalledWith('origin', 'git@host:repo.git');
  });

  it('reuses existing origin when URL matches', async () => {
    mockGit.raw
      .mockResolvedValueOnce('.git') // rev-parse succeeds → is a repo
      .mockResolvedValueOnce(''); // status --porcelain
    mockGit.getRemotes.mockResolvedValueOnce([
      { name: 'origin', refs: { fetch: 'git@host:repo.git' } },
    ]);

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(mockGit.init).not.toHaveBeenCalled();
    expect(mockGit.addRemote).not.toHaveBeenCalled();
  });

  it('errors when origin URL differs', async () => {
    mockGit.raw.mockResolvedValueOnce('.git');
    mockGit.getRemotes.mockResolvedValueOnce([
      { name: 'origin', refs: { fetch: 'git@host:other.git' } },
    ]);

    await expect(handleInit({ path: '/dir', remote: 'git@host:repo.git' })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Remote 'origin' already exists with a different URL"),
    );
  });

  it('errors when origin URL differs (json mode)', async () => {
    mockGit.raw.mockResolvedValueOnce('.git');
    mockGit.getRemotes.mockResolvedValueOnce([
      { name: 'origin', refs: { fetch: 'git@host:other.git' } },
    ]);

    await expect(
      handleInit({ path: '/dir', remote: 'git@host:repo.git', json: true }),
    ).rejects.toThrow('printJsonError');

    expect(mockPrintJsonError).toHaveBeenCalledWith(
      'init',
      expect.stringContaining('REMOTE_CONFLICT') ? expect.any(String) : '',
      'REMOTE_CONFLICT',
    );
  });

  it('adds origin when repo exists but has no origin remote', async () => {
    mockGit.raw
      .mockResolvedValueOnce('.git') // is a repo
      .mockResolvedValueOnce(''); // status --porcelain
    mockGit.getRemotes.mockResolvedValueOnce([]);

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(mockGit.addRemote).toHaveBeenCalledWith('origin', 'git@host:repo.git');
  });

  it('warns when .gitignore misses syncthis entries', async () => {
    mockGit.raw
      .mockRejectedValueOnce(new Error('not a repo'))
      .mockResolvedValueOnce(undefined) // symbolic-ref
      .mockResolvedValueOnce(''); // status --porcelain

    // First access call: .syncthis.json → not found; second: .gitignore → exists
    mockAccess.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce('# empty gitignore\n');

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('.syncthis.lock'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('.syncthis/'));
  });

  it('creates .gitignore when it does not exist', async () => {
    mockGit.raw
      .mockRejectedValueOnce(new Error('not a repo'))
      .mockResolvedValueOnce(undefined) // symbolic-ref
      .mockResolvedValueOnce(''); // status --porcelain

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      expect.stringContaining('.syncthis.lock'),
      'utf8',
    );
  });

  it('commits and pushes when there are untracked files', async () => {
    mockGit.raw
      .mockRejectedValueOnce(new Error('not a repo'))
      .mockResolvedValueOnce(undefined) // symbolic-ref
      .mockResolvedValueOnce('?? .syncthis.json\n'); // status --porcelain

    await handleInit({ path: '/dir', remote: 'git@host:repo.git' });

    expect(mockGit.add).toHaveBeenCalledWith(['-A']);
    expect(mockGit.commit).toHaveBeenCalledWith('chore: initial syncthis setup');
    expect(mockGit.push).toHaveBeenCalledWith(['--set-upstream', 'origin', 'main']);
  });

  it('outputs JSON when --json is set', async () => {
    mockGit.raw
      .mockRejectedValueOnce(new Error('not a repo'))
      .mockResolvedValueOnce(undefined) // symbolic-ref
      .mockResolvedValueOnce(''); // status --porcelain

    await handleInit({ path: '/dir', remote: 'git@host:repo.git', json: true });

    expect(mockPrintJson).toHaveBeenCalledWith('init', {
      dirPath: '/dir',
      remote: 'git@host:repo.git',
      branch: 'main',
      cloned: false,
    });
  });
});

// ---------------------------------------------------------------------------
// handleInitClone
// ---------------------------------------------------------------------------

describe('handleInitClone', () => {
  it('errors when target directory is not empty', async () => {
    mockReaddir.mockResolvedValueOnce(['file.txt']);

    await expect(handleInit({ path: '/dir', clone: 'git@host:repo.git' })).rejects.toThrow(
      'process.exit(1)',
    );

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not empty'));
  });

  it('errors when target directory is not empty (json mode)', async () => {
    mockReaddir.mockResolvedValueOnce(['file.txt']);

    await expect(
      handleInit({ path: '/dir', clone: 'git@host:repo.git', json: true }),
    ).rejects.toThrow('printJsonError');

    expect(mockPrintJsonError).toHaveBeenCalledWith(
      'init',
      expect.stringContaining('not empty'),
      'DIR_NOT_EMPTY',
    );
  });

  it('proceeds when directory does not exist (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValueOnce(enoent);

    await handleInit({ path: '/dir', clone: 'git@host:repo.git' });

    expect(mockGit.clone).toHaveBeenCalledWith('git@host:repo.git', '/dir');
    expect(mockWriteConfig).toHaveBeenCalled();
  });

  it('rethrows non-ENOENT errors from readdir', async () => {
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    mockReaddir.mockRejectedValueOnce(eperm);

    await expect(handleInit({ path: '/dir', clone: 'git@host:repo.git' })).rejects.toThrow('EPERM');
  });

  it('clones into empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    await handleInit({ path: '/dir', clone: 'git@host:repo.git' });

    expect(mockGit.clone).toHaveBeenCalledWith('git@host:repo.git', '/dir');
  });

  it('outputs JSON when --json is set', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    await handleInit({ path: '/dir', clone: 'git@host:repo.git', json: true });

    expect(mockPrintJson).toHaveBeenCalledWith('init', {
      dirPath: '/dir',
      remote: 'git@host:repo.git',
      branch: 'main',
      cloned: true,
    });
  });
});
