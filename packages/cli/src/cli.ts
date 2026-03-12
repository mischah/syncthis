import meow from 'meow';
import { daemonLogs, daemonStop, daemonUninstall, handleList } from './commands/daemon.js';
import { handleInit } from './commands/init.js';
import { handleResolve } from './commands/resolve.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';

function flagExplicitlyPassed(name: string): boolean {
  return process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

const COMMAND_HELP: Record<string, string> = {
  init: `
  Usage
    $ syncthis init [options]

  Initialize a directory for sync.

  Options
    --remote    Set up sync for an existing directory
    --clone     Clone a remote repository first
                (use --remote or --clone, not both)
    --branch    Branch name
    --path      Target directory (default: current directory)
`,
  start: `
  Usage
    $ syncthis start [options]

  Start the background sync service. Use --foreground to run in the
  current terminal instead.

  Options
    --all               Start all registered services
    --foreground        Run in foreground instead of as service
    --cron              Cron expression for sync schedule
    --interval          Sync interval in seconds
                        (use --cron or --interval, not both)
    --on-conflict       Conflict strategy: stop, auto-both, auto-newest, ask (default: auto-both)
    --log-level         Log verbosity: debug, info, warn, error (default: info)
    --label             Custom service name
    --enable-autostart  Start service on login
    --path              Target directory (default: current directory)
`,
  resolve: `
  Usage
    $ syncthis resolve [options]

  Interactively resolve rebase conflicts. Shows a diff per file
  and lets you choose local, remote, both, or abort.

  Options
    --path      Target directory (default: current directory)
`,
  stop: `
  Usage
    $ syncthis stop [options]

  Stop the background sync service.

  Options
    --all       Stop all registered services
    --label     Custom service name
    --path      Target directory (default: current directory)
`,
  status: `
  Usage
    $ syncthis status [options]

  Show sync and service status.

  Options
    --all       Show overview of all registered services
    --label     Custom service name
    --path      Target directory (default: current directory)
`,
  list: `
  Usage
    $ syncthis list [options]

  List all registered syncthis services.

  Options
    --stale     Show only stale services (target directory missing)
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
    --all       Remove all registered services
    --label     Custom service name
    --stale     Remove all stale services (target directory missing)
    --path      Target directory (default: current directory)
`,
};

const cli = meow(
  `
  Usage
    $ syncthis <command> [options]

  Commands
    init              Initialize a directory for sync
      --remote            Set up sync for an existing directory
      --clone             Clone a remote repository first
                          (use --remote or --clone, not both)
      --branch            Branch name

    start             Start background sync service
      --all               Start all registered services
      --foreground        Run in foreground instead of as service
      --cron              Cron expression for sync schedule
      --interval          Sync interval in seconds
                          (use --cron or --interval, not both)
      --on-conflict       Conflict strategy: stop, auto-both, auto-newest, ask (default: auto-both)
      --log-level         Log verbosity: debug, info, warn, error (default: info)
      --label             Custom service name
      --enable-autostart  Start service on login

      stop            Stop background sync service
      --all               Stop all registered services
      --label             Custom service name

      status          Show sync and service status
      --all               Show overview of all registered services
      --label             Custom service name

      resolve         Interactively resolve rebase conflicts

      list            List all registered services
      --stale             Show only stale services

      logs            Show sync logs
      --follow, -f        Follow log output
      --lines, -n         Number of log lines (default: 50)

      uninstall       Remove background sync service
      --all               Remove all registered services
      --label             Custom service name
      --stale             Remove all stale services

  Global options
    --path              Target directory (default: current directory)
    --help, -h          Show help text
    --version, -v       Show version number

  Examples
    $ syncthis init --remote git@github.com:user/vault.git
    $ syncthis start --path ~/vault
    $ syncthis start --interval 60
    $ syncthis start --foreground
    $ syncthis start --all
    $ syncthis stop --all
    $ syncthis status --all
    $ syncthis resolve --path ~/vault
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
      onConflict: { type: 'string' },
      logLevel: { type: 'string', default: 'info' },
      label: { type: 'string' },
      foreground: { type: 'boolean', default: false },
      enableAutostart: { type: 'boolean', default: false },
      stale: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
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

// --all validation
if (cli.flags.all) {
  const allSupportedCommands = ['start', 'stop', 'uninstall', 'status'];
  if (command === undefined || !allSupportedCommands.includes(command)) {
    console.error(`Error: --all is only supported with: ${allSupportedCommands.join(', ')}`);
    process.exit(1);
  }
  if (flagExplicitlyPassed('path')) {
    console.error('Error: --all and --path are mutually exclusive.');
    process.exit(1);
  }
  if (cli.flags.label !== undefined) {
    console.error('Error: --all and --label are mutually exclusive.');
    process.exit(1);
  }
  if (command === 'start' && cli.flags.foreground) {
    console.error('Error: --all and --foreground are mutually exclusive.');
    process.exit(1);
  }
  if (command === 'uninstall' && cli.flags.stale) {
    console.error('Error: --all and --stale are mutually exclusive.');
    process.exit(1);
  }
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
      onConflict: cli.flags.onConflict,
      logLevel: cli.flags.logLevel,
      label: cli.flags.label,
      enableAutostart: cli.flags.enableAutostart,
      all: cli.flags.all,
    });
    break;
  case 'stop':
    if (showCommandHelp('stop')) break;
    try {
      await daemonStop({
        path: cli.flags.path,
        label: cli.flags.label,
        all: cli.flags.all,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case 'status':
    if (showCommandHelp('status')) break;
    await handleStatus({
      path: cli.flags.path,
      label: cli.flags.label,
      all: cli.flags.all,
      pathExplicit: flagExplicitlyPassed('path'),
    });
    break;
  case 'resolve':
    if (showCommandHelp('resolve')) break;
    await handleResolve({ path: cli.flags.path });
    break;
  case 'list':
    if (showCommandHelp('list')) break;
    await handleList({ stale: cli.flags.stale });
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
    try {
      await daemonUninstall({
        path: cli.flags.path,
        label: cli.flags.label,
        stale: cli.flags.stale,
        all: cli.flags.all,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case undefined:
    cli.showHelp(0);
    break;
  default:
    console.error(`Error: Unknown command '${command}'. Run 'syncthis --help' for usage.`);
    cli.showHelp(2);
}
