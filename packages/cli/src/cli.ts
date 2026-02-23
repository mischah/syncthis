import meow from 'meow';
import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';

const cli = meow(
  `
  Usage
    $ syncthis <command> [options]

  Commands
    init      Initialize a directory for sync
    start     Start the sync loop
    status    Show sync status

  Options
    --path        Target directory (default: current directory)
    --help        Show this help text
    --version     Show version number

  Examples
    $ syncthis init --remote git@github.com:user/vault.git
    $ syncthis init --clone git@github.com:user/vault.git --path ./my-vault
    $ syncthis start --cron "*/5 * * * *"
    $ syncthis start --interval 300
    $ syncthis status
`,
  {
    importMeta: import.meta,
    flags: {
      path: { type: 'string', default: process.cwd() },
      remote: { type: 'string' },
      clone: { type: 'string' },
      branch: { type: 'string' },
      cron: { type: 'string' },
      interval: { type: 'number' },
      logLevel: { type: 'string', default: 'info' },
    },
  },
);

const command = cli.input[0];

switch (command) {
  case 'init':
    await handleInit({
      path: cli.flags.path,
      remote: cli.flags.remote,
      clone: cli.flags.clone,
      branch: cli.flags.branch,
    });
    break;
  case 'start':
    await handleStart({
      path: cli.flags.path,
      cron: cli.flags.cron,
      interval: cli.flags.interval,
      logLevel: cli.flags.logLevel,
    });
    break;
  case 'status':
    await handleStatus({
      path: cli.flags.path,
    });
    break;
  case undefined:
    cli.showHelp(0);
    break;
  default:
    console.error(`Error: Unknown command '${command}'. Run 'syncthis --help' for usage.`);
    cli.showHelp(2);
}
