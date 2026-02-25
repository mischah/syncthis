import meow from 'meow';
import { handleDaemon } from './commands/daemon.js';
import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';

const cli = meow(
  `
  Usage
    $ syncthis <command> [options]

  Commands
    init      Initialize a directory for sync
    start     Start the sync loop (foreground)
    status    Show sync status
    daemon    Manage background sync service

  Daemon Subcommands
    daemon start        Install and start background sync
    daemon stop         Stop background sync
    daemon status       Show daemon status (all or specific)
    daemon uninstall    Remove background sync service
    daemon logs         Show daemon logs

  Options
    --path              Target directory (default: current directory)
    --label             Custom daemon service name
    --enable-autostart  Start daemon on login (default: off)
    --follow, -f        Follow log output (daemon logs)
    --help              Show this help text
    --version           Show version number

  Examples
    $ syncthis daemon start --path ~/vault
    $ syncthis daemon start --label my-vault --enable-autostart
    $ syncthis daemon status
    $ syncthis daemon status --label my-vault
    $ syncthis daemon logs --follow
    $ syncthis daemon stop
    $ syncthis daemon uninstall
`,
  {
    importMeta: import.meta,
    allowUnknownFlags: false,
    flags: {
      path: { type: 'string', default: process.cwd() },
      remote: { type: 'string' },
      clone: { type: 'string' },
      branch: { type: 'string' },
      cron: { type: 'string' },
      interval: { type: 'number' },
      logLevel: { type: 'string', default: 'info' },
      label: { type: 'string' },
      enableAutostart: { type: 'boolean', default: false },
      follow: { type: 'boolean', default: false, shortFlag: 'f' },
      lines: { type: 'number', default: 50, shortFlag: 'n' },
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
  case 'daemon': {
    const subcommand = cli.input[1];
    await handleDaemon(subcommand, {
      path: cli.flags.path,
      label: cli.flags.label,
      enableAutostart: cli.flags.enableAutostart,
      cron: cli.flags.cron,
      interval: cli.flags.interval,
      logLevel: cli.flags.logLevel,
      follow: cli.flags.follow,
      lines: cli.flags.lines,
    });
    break;
  }
  case undefined:
    cli.showHelp(0);
    break;
  default:
    console.error(`Error: Unknown command '${command}'. Run 'syncthis --help' for usage.`);
    cli.showHelp(2);
}
