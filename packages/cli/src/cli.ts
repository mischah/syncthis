import meow from 'meow';
import { daemonLogs, daemonStop, daemonUninstall, handleList } from './commands/daemon.js';
import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';

const cli = meow(
  `
  Usage
    $ syncthis <command> [options]

  Commands
    init        Initialize a directory for sync
    start       Start background sync service
    stop        Stop background sync service
    status      Show sync and service status
    list        List all registered services
    logs        Show sync logs
    uninstall   Remove background sync service

  Options
    --path              Target directory (default: current directory)
    --foreground        Run in foreground instead of as service (start)
    --label             Custom service name
    --enable-autostart  Start service on login (default: off)
    --follow, -f        Follow log output (logs)
    --lines, -n         Number of log lines (default: 50)
    --help              Show this help text
    --version           Show version number

  Examples
    $ syncthis start --path ~/vault
    $ syncthis start --enable-autostart
    $ syncthis start --foreground
    $ syncthis status
    $ syncthis list
    $ syncthis logs --follow
    $ syncthis stop
    $ syncthis uninstall
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
      foreground: { type: 'boolean', default: false },
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
      foreground: cli.flags.foreground,
      cron: cli.flags.cron,
      interval: cli.flags.interval,
      logLevel: cli.flags.logLevel,
      label: cli.flags.label,
      enableAutostart: cli.flags.enableAutostart,
    });
    break;
  case 'stop':
    await daemonStop({
      path: cli.flags.path,
      label: cli.flags.label,
    });
    break;
  case 'status':
    await handleStatus({
      path: cli.flags.path,
      label: cli.flags.label,
    });
    break;
  case 'list':
    await handleList();
    break;
  case 'logs':
    await daemonLogs({
      path: cli.flags.path,
      follow: cli.flags.follow,
      lines: cli.flags.lines,
    });
    break;
  case 'uninstall':
    await daemonUninstall({
      path: cli.flags.path,
      label: cli.flags.label,
    });
    break;
  case undefined:
    cli.showHelp(0);
    break;
  default:
    console.error(`Error: Unknown command '${command}'. Run 'syncthis --help' for usage.`);
    cli.showHelp(2);
}
