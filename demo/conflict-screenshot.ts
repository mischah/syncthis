import { intro, isCancel, log, outro, select } from '@clack/prompts';
import { Chalk } from 'chalk';
import {
  renderConflictDiff,
  renderStatusLine,
} from '../packages/cli/src/conflict/diff-renderer.js';
import { resolveChunkByChunk } from '../packages/cli/src/conflict/hunk-resolver.js';

const chalk = new Chalk({ level: 3 });

const filePath = 'notes/project-sync-meeting.md';

const localContent = `# Project Sync Meeting

Date: 2026-03-10
Attendees: Alice, Bob

## Action Items
- [ ] Review API design document
- [ ] Set up staging environment
- [ ] Update project timeline

## Notes
The team agreed to postpone the release by one week.
We need to finalize the API before moving forward.
`;

const remoteContent = `# Project Sync Meeting

Date: 2026-03-10
Attendees: Alice, Bob, Charlie

## Action Items
- [x] Review API design document
- [ ] Set up staging environment
- [ ] Update project timeline
- [ ] Draft migration guide

## Notes
The team agreed to postpone the release by two weeks.
We need to finalize the API before moving forward.
Charlie will handle the database migration.
`;

const fileName = filePath.split('/').pop() ?? filePath;
const fileProgress = { index: 0, total: 1, resolved: 0 };

async function main() {
  intro('syncthis – Conflict Resolution');

  const statusLine = renderStatusLine({
    file: fileProgress,
    fileName,
  });

  console.clear();
  log.step(statusLine);
  const diffOutput = renderConflictDiff(filePath, localContent, remoteContent, {
    localLabel: 'local version',
    remoteLabel: 'remote version',
    terminalWidth: 80,
  });
  console.log(diffOutput);
  log.step(statusLine);

  const choice = await select({
    message: `How do you want to resolve ${fileName}?`,
    options: [
      {
        value: 'local',
        label: `${chalk.red('■')} Keep local version`,
        hint: 'discard remote changes',
      },
      {
        value: 'remote',
        label: `${chalk.green('■')} Keep remote version`,
        hint: 'discard local changes',
      },
      { value: 'both', label: '  Keep both versions', hint: 'remote saved as .conflict copy' },
      {
        value: 'chunk-by-chunk',
        label: '  Resolve chunk-by-chunk',
        hint: 'decide per diff hunk',
      },
      { value: 'abort', label: '  Abort rebase', hint: 'cancel and undo all changes' },
    ],
  });

  if (isCancel(choice)) return;

  if (choice === 'chunk-by-chunk') {
    await resolveChunkByChunk(localContent, remoteContent, filePath, fileProgress);
  }

  console.clear();
  outro('✓ All conflicts resolved. 1 file resolved.');
}

main();
