import { describe, expect, it } from 'vitest';
import type { DaemonConfig } from '../../src/daemon/platform.js';
import { generatePlist, generateSystemdUnit } from '../../src/daemon/templates.js';

const BASE_CONFIG: DaemonConfig = {
  serviceName: 'com.syncthis.user-vault-notes',
  dirPath: '/home/user/vault-notes',
  nodeExecutable: '/usr/local/bin/node',
  syncthisBinary: '/usr/local/bin/syncthis',
  autostart: false,
};

describe('generatePlist', () => {
  it('contains correct Label (serviceName)', () => {
    const plist = generatePlist(BASE_CONFIG);
    expect(plist).toContain('<string>com.syncthis.user-vault-notes</string>');
  });

  it('contains correct ProgramArguments (nodeExecutable, syncthisBinary, start, --path, dirPath)', () => {
    const plist = generatePlist(BASE_CONFIG);
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/usr/local/bin/syncthis</string>');
    expect(plist).toContain('<string>start</string>');
    expect(plist).toContain('<string>--path</string>');
    expect(plist).toContain('<string>/home/user/vault-notes</string>');
  });

  it('RunAtLoad is <false/> when autostart is false', () => {
    const plist = generatePlist({ ...BASE_CONFIG, autostart: false });
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).not.toContain('<true/>');
  });

  it('RunAtLoad is <true/> when autostart is true', () => {
    const plist = generatePlist({ ...BASE_CONFIG, autostart: true });
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
  });

  it('contains KeepAlive with SuccessfulExit = <false/>', () => {
    const plist = generatePlist(BASE_CONFIG);
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).toContain('<false/>');
  });

  it('contains correct StandardOutPath and StandardErrorPath log paths', () => {
    const plist = generatePlist(BASE_CONFIG);
    expect(plist).toContain(
      '<string>/home/user/vault-notes/.syncthis/logs/launchd-stdout.log</string>',
    );
    expect(plist).toContain(
      '<string>/home/user/vault-notes/.syncthis/logs/launchd-stderr.log</string>',
    );
  });

  it('contains --log-level argument when logLevel is set', () => {
    const plist = generatePlist({ ...BASE_CONFIG, logLevel: 'debug' });
    expect(plist).toContain('<string>--log-level</string>');
    expect(plist).toContain('<string>debug</string>');
  });

  it('does not contain --log-level when logLevel is not set', () => {
    const plist = generatePlist(BASE_CONFIG);
    expect(plist).not.toContain('--log-level');
  });

  it('contains --cron argument when cron is set', () => {
    const plist = generatePlist({ ...BASE_CONFIG, cron: '*/5 * * * *' });
    expect(plist).toContain('<string>--cron</string>');
    expect(plist).toContain('<string>*/5 * * * *</string>');
  });
});

describe('generateSystemdUnit', () => {
  it('contains correct ExecStart with node, binary, start, --path, and dirPath', () => {
    const unit = generateSystemdUnit(BASE_CONFIG);
    expect(unit).toContain(
      'ExecStart=/usr/local/bin/node /usr/local/bin/syncthis start --path /home/user/vault-notes',
    );
  });

  it('contains Restart=on-failure and RestartSec=10', () => {
    const unit = generateSystemdUnit(BASE_CONFIG);
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=10');
  });

  it('contains network-online.target in After and Wants', () => {
    const unit = generateSystemdUnit(BASE_CONFIG);
    expect(unit).toContain('After=network-online.target');
    expect(unit).toContain('Wants=network-online.target');
  });

  it('contains WantedBy=default.target in [Install] section', () => {
    const unit = generateSystemdUnit(BASE_CONFIG);
    expect(unit).toContain('WantedBy=default.target');
  });

  it('contains --log-level in ExecStart when logLevel is set', () => {
    const unit = generateSystemdUnit({ ...BASE_CONFIG, logLevel: 'info' });
    expect(unit).toContain('--log-level info');
  });

  it('contains --interval in ExecStart when interval is set', () => {
    const unit = generateSystemdUnit({ ...BASE_CONFIG, interval: 300 });
    expect(unit).toContain('--interval 300');
  });
});
