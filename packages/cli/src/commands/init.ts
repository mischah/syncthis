import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { createDefaultConfig, writeConfig } from '../config.js';

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
    console.error('Error: --remote and --clone are mutually exclusive.');
    process.exit(1);
  }

  if (remote === undefined && clone === undefined) {
    console.error('Error: One of --remote or --clone is required.');
    console.error('  syncthis init --remote git@github.com:user/vault.git');
    console.error('  syncthis init --clone git@github.com:user/vault.git');
    process.exit(1);
  }

  if (remote !== undefined) {
    await handleInitRemote(dirPath, remote, branch);
  } else if (clone !== undefined) {
    await handleInitClone(dirPath, clone, branch);
  }
}

async function handleInitRemote(dirPath: string, remote: string, branch: string): Promise<void> {
  const configPath = join(dirPath, '.syncthis.json');
  if (await fileExists(configPath)) {
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
      if (origin.refs.fetch !== remote) {
        console.error(
          `Error: Remote 'origin' already exists with a different URL: ${origin.refs.fetch}`,
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
    await git.push(['--set-upstream', 'origin', branch]);
  }

  console.log(`Initialized syncthis in ${dirPath}`);
  console.log(`  Remote: ${remote}`);
  console.log(`  Branch: ${branch}`);
  console.log('\nNext steps:');
  console.log('  syncthis start');
}

async function handleInitClone(dirPath: string, cloneUrl: string, branch: string): Promise<void> {
  try {
    const entries = await readdir(dirPath);
    if (entries.length > 0) {
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

  await writeConfig(dirPath, createDefaultConfig(cloneUrl, branch));

  console.log(`Cloned repository to ${dirPath}`);
  console.log(`  Remote: ${cloneUrl}`);
  console.log(`  Branch: ${branch}`);
  console.log('\nNext steps:');
  console.log('  syncthis start');
}
