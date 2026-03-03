import type { DaemonConfig } from './platform.js';

const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function buildProgramArguments(config: DaemonConfig): string[] {
  const args = [config.syncthisBinary, 'start', '--foreground', '--path', config.dirPath];

  if (config.cron !== undefined) {
    args.push('--cron', config.cron);
  } else if (config.interval !== undefined) {
    args.push('--interval', String(config.interval));
  }

  if (config.logLevel !== undefined) {
    args.push('--log-level', config.logLevel);
  }

  return args;
}

function buildPath(nodeBinDir: string): string {
  return `${nodeBinDir}:${DEFAULT_PATH}`;
}

export function generatePlist(config: DaemonConfig): string {
  const args = buildProgramArguments(config);
  const argsXml = args.map((a) => `    <string>${a}</string>`).join('\n');
  const runAtLoad = config.autostart ? '<true/>' : '<false/>';
  const stdoutPath = `${config.dirPath}/.syncthis/logs/launchd-stdout.log`;
  const stderrPath = `${config.dirPath}/.syncthis/logs/launchd-stderr.log`;
  const envPath = buildPath(config.nodeBinDir);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${config.serviceName}</string>

  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${envPath}</string>
  </dict>

  <key>RunAtLoad</key>
  ${runAtLoad}

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>

  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>

  <key>WorkingDirectory</key>
  <string>${config.dirPath}</string>
</dict>
</plist>
`;
}

export function generateSystemdUnit(config: DaemonConfig): string {
  const args = buildProgramArguments(config);
  const execStart = args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  const envPath = buildPath(config.nodeBinDir);

  return `[Unit]
Description=syncthis sync daemon for ${config.dirPath}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${config.dirPath}
Environment=PATH=${envPath}
Restart=on-failure
RestartSec=10

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}
