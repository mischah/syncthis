import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig, writeConfig } from '../config.js';
import { type InitData, printJson, printJsonError } from '../json-output.js';

const GITIGNORE_CONTENT = `# syncthis
.syncthis.lock
.syncthis/

# Obsidian - workspace (device-specific)
.obsidian/workspace.json
.obsidian/workspace-mobile.json

# Obsidian - trash
.trash/

# Obsidian - plugin state (optional, uncomment if needed)
# .obsidian/plugins/*/data.json
`;

export interface InitFlags {
  path: string;
  remote?: string;
  clone?: string;
  branch?: string;
  json?: boolean;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function handleInit(flags: InitFlags): Promise<void> {
  const { remote, clone } = flags;
  const branch = flags.branch ?? 'main';
  const dirPath = flags.path;

  if (remote !== undefined && clone !== undefined) {
    if (flags.json)
      printJsonError('init', '--remote and --clone are mutually exclusive.', 'INVALID_FLAGS');
    console.error('Error: --remote and --clone are mutually exclusive.');
    process.exit(1);
  }

  if (remote === undefined && clone === undefined) {
    if (flags.json)
      printJsonError('init', 'One of --remote or --clone is required.', 'INVALID_FLAGS');
    console.error('Error: One of --remote or --clone is required.');
    console.error('  syncthis init --remote git@github.com:user/vault.git');
    console.error('  syncthis init --clone git@github.com:user/vault.git');
    process.exit(1);
  }

  if (remote !== undefined) {
    await handleInitRemote(dirPath, remote, branch, flags.json);
  } else if (clone !== undefined) {
    await handleInitClone(dirPath, clone, branch, flags.json);
  }
}

function stripCredentials(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url; // SSH or other non-HTTP URLs — compare as-is
  }
}

async function handleInitRemote(
  dirPath: string,
  remote: string,
  branch: string,
  json?: boolean,
): Promise<void> {
  const configPath = join(dirPath, '.syncthis.json');
  if (await fileExists(configPath)) {
    if (json)
      printJsonError('init', 'Already initialized (.syncthis.json exists).', 'ALREADY_INITIALIZED');
    console.error('Error: Already initialized (.syncthis.json exists).');
    process.exit(1);
  }

  const git = simpleGit(dirPath);

  const isRepo = await git
    .raw(['rev-parse', '--git-dir'])
    .then(() => true)
    .catch(() => false);

  if (!isRepo) {
    await git.init();
    await git.raw(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    await git.addRemote('origin', remote);
  } else {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (origin !== undefined) {
      if (stripCredentials(origin.refs.fetch) !== stripCredentials(remote)) {
        if (json)
          printJsonError(
            'init',
            `Remote 'origin' already exists with a different URL: ${stripCredentials(origin.refs.fetch)}`,
            'REMOTE_CONFLICT',
          );
        console.error(
          `Error: Remote 'origin' already exists with a different URL: ${stripCredentials(origin.refs.fetch)}`,
        );
        process.exit(1);
      }
      // URL matches – continue
    } else {
      await git.addRemote('origin', remote);
    }
  }

  await writeConfig(dirPath, createDefaultConfig(remote, branch));

  const gitignorePath = join(dirPath, '.gitignore');
  if (await fileExists(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf8');
    if (!content.includes('.syncthis.lock')) {
      console.warn(
        "WARN: .gitignore exists but does not contain '.syncthis.lock'. Consider adding it.",
      );
    }
    if (!content.includes('.syncthis/')) {
      console.warn(
        "WARN: .gitignore exists but does not contain '.syncthis/'. Consider adding it.",
      );
    }
  } else {
    await writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
  }

  // Initial commit if there are staged/untracked files
  const statusOutput = await git.raw(['status', '--porcelain']);
  if (statusOutput.trim() !== '') {
    await git.add(['-A']);
    await git.commit('chore: initial syncthis setup');
    try {
      await git.push(['--set-upstream', 'origin', branch]);
    } catch {
      // Push may fail if remote has diverged commits (e.g. repo created with a README).
      // Non-fatal: the sync service will pull and reconcile on first run.
    }
  }

  if (json) {
    const data: InitData = { dirPath, remote, branch, cloned: false };
    printJson('init', data);
    return;
  }
  console.log(`Initialized syncthis in ${dirPath}`);
  console.log(`  Remote: ${remote}`);
  console.log(`  Branch: ${branch}`);
  console.log('\nNext steps:');
  console.log('  syncthis start');
}

async function handleInitClone(
  dirPath: string,
  cloneUrl: string,
  branch: string,
  json?: boolean,
): Promise<void> {
  try {
    const entries = await readdir(dirPath);
    if (entries.length > 0) {
      if (json)
        printJsonError('init', `Directory exists and is not empty: ${dirPath}`, 'DIR_NOT_EMPTY');
      console.error(`Error: Directory exists and is not empty: ${dirPath}`);
      process.exit(1);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // ENOENT: directory doesn't exist – git clone will create it
  }

  const git = simpleGit();
  await git.clone(cloneUrl, dirPath);

  await writeConfig(dirPath, createDefaultConfig(stripCredentials(cloneUrl), branch));

  if (json) {
    const data: InitData = { dirPath, remote: cloneUrl, branch, cloned: true };
    printJson('init', data);
    return;
  }
  console.log(`Cloned repository to ${dirPath}`);
  console.log(`  Remote: ${cloneUrl}`);
  console.log(`  Branch: ${branch}`);
  console.log('\nNext steps:');
  console.log('  syncthis start');
}
