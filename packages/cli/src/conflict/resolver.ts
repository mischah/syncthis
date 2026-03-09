import { existsSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SimpleGit } from 'simple-git';
import type { Logger } from '../logger.js';
import { generateConflictFilename } from './conflict-filename.js';

export interface ConflictFile {
  filePath: string;
  localTimestamp?: string;
  remoteTimestamp?: string;
}

export interface ResolveResult {
  status: 'resolved' | 'aborted' | 'stopped';
  resolvedFiles: string[];
  conflictCopies: string[];
  rebaseSteps: number;
}

export async function getConflictFiles(git: SimpleGit): Promise<ConflictFile[]> {
  const output = await git.raw(['diff', '--name-only', '--diff-filter=U']);
  return output
    .split('\n')
    .filter(Boolean)
    .map((filePath) => ({ filePath }));
}

async function autoBoth(
  git: SimpleGit,
  file: ConflictFile,
  timestamp: Date,
  dirPath: string,
): Promise<{ action: 'both'; conflictCopy: string }> {
  const remoteContent = await git.raw(['show', `HEAD:${file.filePath}`]);
  const conflictCopyPath = generateConflictFilename(file.filePath, timestamp, (p) =>
    existsSync(path.join(dirPath, p)),
  );
  await writeFile(path.join(dirPath, conflictCopyPath), remoteContent, 'utf8');
  await git.raw(['checkout', '--theirs', file.filePath]);
  await git.add([file.filePath, conflictCopyPath]);
  return { action: 'both', conflictCopy: conflictCopyPath };
}

async function autoNewest(
  git: SimpleGit,
  file: ConflictFile,
  timestamp: Date,
  dirPath: string,
): Promise<{ action: 'ours' | 'theirs' | 'both'; conflictCopy?: string }> {
  const localTs = (await git.raw(['log', '-1', '--format=%aI', '--', file.filePath])).trim();
  const remoteTs = (
    await git.raw(['log', '-1', '--format=%aI', 'REBASE_HEAD', '--', file.filePath])
  ).trim();

  if (localTs > remoteTs) {
    await git.raw(['checkout', '--ours', file.filePath]);
    await git.add([file.filePath]);
    return { action: 'ours' };
  }

  if (remoteTs > localTs) {
    await git.raw(['checkout', '--theirs', file.filePath]);
    await git.add([file.filePath]);
    return { action: 'theirs' };
  }

  return autoBoth(git, file, timestamp, dirPath);
}

export async function resolveFile(
  git: SimpleGit,
  file: ConflictFile,
  strategy: 'auto-both' | 'auto-newest',
  timestamp: Date,
  dirPath: string,
  userChoice?: 'local' | 'remote' | 'both',
): Promise<{ action: 'ours' | 'theirs' | 'both'; conflictCopy?: string }> {
  if (userChoice === 'local') {
    await git.raw(['checkout', '--ours', file.filePath]);
    await git.add([file.filePath]);
    return { action: 'ours' };
  }
  if (userChoice === 'remote') {
    await git.raw(['checkout', '--theirs', file.filePath]);
    await git.add([file.filePath]);
    return { action: 'theirs' };
  }
  if (userChoice === 'both') {
    return autoBoth(git, file, timestamp, dirPath);
  }
  if (strategy === 'auto-both') {
    return autoBoth(git, file, timestamp, dirPath);
  }
  return autoNewest(git, file, timestamp, dirPath);
}

export async function isRebaseInProgress(git: SimpleGit): Promise<boolean> {
  const gitDir = (await git.revparse(['--absolute-git-dir'])).trim();
  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  const rebaseApply = path.join(gitDir, 'rebase-apply');

  const exists = async (p: string): Promise<boolean> => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  };

  return (await exists(rebaseMerge)) || (await exists(rebaseApply));
}

export async function resolveRebase(
  git: SimpleGit,
  strategy: 'auto-both' | 'auto-newest',
  dirPath: string,
  logger: Logger,
  maxSteps = 20,
): Promise<ResolveResult> {
  let steps = 0;
  const resolvedFiles: string[] = [];
  const conflictCopies: string[] = [];

  while (true) {
    const files = await getConflictFiles(git);
    if (files.length === 0) break;

    const timestamp = new Date();
    for (const file of files) {
      const result = await resolveFile(git, file, strategy, timestamp, dirPath);
      resolvedFiles.push(file.filePath);
      if (result.conflictCopy) {
        conflictCopies.push(result.conflictCopy);
      }
    }

    try {
      await git.raw(['rebase', '--continue']);
    } catch {
      // New conflicts from the next commit will be picked up on the next iteration.
      // A real rebase error (non-conflict) will surface as an empty getConflictFiles
      // on the next iteration and cause an early resolved return — acceptable for v1.
    }

    steps++;
    if (steps > maxSteps) {
      logger.error(
        `Too many consecutive conflicts during rebase (${maxSteps}+). Automatic resolution aborted. Resolve manually.`,
      );
      await git.raw(['rebase', '--abort']);
      return { status: 'aborted', resolvedFiles, conflictCopies, rebaseSteps: steps };
    }
  }

  // The loop exits when getConflictFiles() returns empty, but if rebase --continue threw on
  // the previous iteration, the rebase may still be in progress with staged changes pending.
  if (await isRebaseInProgress(git)) {
    try {
      await git.raw(['rebase', '--continue']);
    } catch (err) {
      if (await isRebaseInProgress(git)) {
        logger.error(`Failed to finalize rebase after conflict resolution: ${String(err)}`);
        return { status: 'stopped', resolvedFiles, conflictCopies, rebaseSteps: steps };
      }
      // Rebase completed despite the throw (simple-git noise) — fall through to 'resolved'
    }
  }

  return { status: 'resolved', resolvedFiles, conflictCopies, rebaseSteps: steps };
}
