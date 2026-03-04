import meow from 'meow';
import { daemonLogs, daemonStop, daemonUninstall, handleList } from './commands/daemon.js';
import { handleInit } from './commands/init.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';

const COMMAND_HELP: Record<string, string> = {
  init: `
  Usage
    $ syncthis init [options]

  Initialize a directory for sync.

  Options
    --remote    Remote repository URL (required)
    --clone     Clone from existing remote
    --branch    Branch name
    --path      Target directory (default: current directory)
`,
  start: `
  Usage
    $ syncthis start [options]

  Start the background sync service. Use --foreground to run in the
  current terminal instead.

  Options
    --foreground        Run in foreground instead of as service
    --cron              Cron expression for sync schedule (mutually exclusive)
    --interval          Sync interval in seconds (mutually exclusive)
    --label             Custom service name
    --enable-autostart  Start service on login
    --path              Target directory (default: current directory)
`,
  stop: `
  Usage
    $ syncthis stop [options]

  Stop the background sync service.

  Options
    --label     Custom service name
    --path      Target directory (default: current directory)
`,
  status: `
  Usage
    $ syncthis status [options]

  Show sync and service status.

  Options
    --label     Custom service name
    --path      Target directory (default: current directory)
`,
  list: `
  Usage
    $ syncthis list

  List all registered syncthis services.
`,
  logs: `
  Usage
    $ syncthis logs [options]

  Show sync logs.

  Options
    --follow, -f    Follow log output
    --lines, -n     Number of log lines (default: 50)
    --path          Target directory (default: current directory)
`,
  uninstall: `
  Usage
    $ syncthis uninstall [options]

  Remove the background sync service.

  Options
    --label     Custom service name
    --path      Target directory (default: current directory)
`,
};

const cli = meow(
  `
  Usage
    $ syncthis <command> [options]

  Commands
    init        Initialize a directory for sync
      --remote            Remote repository URL (required)
      --clone             Clone from existing remote
      --branch            Branch name
    start       Start background sync service
      --foreground        Run in foreground instead of as service
      --cron              Cron expression for sync schedule (mutually exclusive)
      --interval          Sync interval in seconds (mutually exclusive)
      --label             Custom service name
      --enable-autostart  Start service on login
    stop        Stop background sync service
      --label             Custom service name
    status      Show sync and service status
      --label             Custom service name
    list        List all registered services
    logs        Show sync logs
      --follow, -f        Follow log output
      --lines, -n         Number of log lines (default: 50)
    uninstall   Remove background sync service
      --label             Custom service name

  Global options
    --path              Target directory (default: current directory)
    --help, -h          Show help text
    --version, -v       Show version number

  Examples
    $ syncthis init --remote git@github.com:user/vault.git
    $ syncthis start --path ~/vault
    $ syncthis start --interval 60
    $ syncthis start --foreground
    $ syncthis logs --follow
    $ syncthis status
`,
  {
    importMeta: import.meta,
    autoHelp: false,
    autoVersion: false,
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
      help: { type: 'boolean', default: false, shortFlag: 'h' },
      version: { type: 'boolean', default: false, shortFlag: 'v' },
    },
  },
);

if (cli.flags.version) {
  cli.showVersion();
  process.exit(0);
}

const command = cli.input[0];

function showCommandHelp(cmd: string): boolean {
  if (!cli.flags.help) return false;
  const help = COMMAND_HELP[cmd];
  if (help) {
    console.log(help);
  } else {
    cli.showHelp(0);
  }
  return true;
}

switch (command) {
  case 'init':
    if (showCommandHelp('init')) break;
    await handleInit({
      path: cli.flags.path,
      remote: cli.flags.remote,
      clone: cli.flags.clone,
      branch: cli.flags.branch,
    });
    break;
  case 'start':
    if (showCommandHelp('start')) break;
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
    if (showCommandHelp('stop')) break;
    await daemonStop({
      path: cli.flags.path,
      label: cli.flags.label,
    });
    break;
  case 'status':
    if (showCommandHelp('status')) break;
    await handleStatus({
      path: cli.flags.path,
      label: cli.flags.label,
    });
    break;
  case 'list':
    if (showCommandHelp('list')) break;
    await handleList();
    break;
  case 'logs':
    if (showCommandHelp('logs')) break;
    await daemonLogs({
      path: cli.flags.path,
      follow: cli.flags.follow,
      lines: cli.flags.lines,
    });
    break;
  case 'uninstall':
    if (showCommandHelp('uninstall')) break;
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
