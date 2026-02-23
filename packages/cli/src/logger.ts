import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(options: { level: LogLevel; logDir: string }): Logger {
  const { level, logDir } = options;
  const logFile = join(logDir, 'syncthis.log');
  let logDirEnsured = false;

  function ensureLogDir(): void {
    if (!logDirEnsured) {
      mkdirSync(logDir, { recursive: true });
      logDirEnsured = true;
    }
  }

  function formatMessage(msgLevel: LogLevel, args: unknown[]): string {
    const timestamp = new Date().toISOString();
    // Pad level tag to 8 chars so messages align:
    // [INFO]   → "[INFO]  " (6+2 spaces)
    // [ERROR]  → "[ERROR] " (7+1 space)
    const levelTag = `[${msgLevel.toUpperCase()}]`.padEnd(8);
    const message = args.map((a) => String(a)).join(' ');
    return `[${timestamp}] ${levelTag}${message}`;
  }

  function log(msgLevel: LogLevel, args: unknown[]): void {
    if (LEVEL_ORDER[msgLevel] < LEVEL_ORDER[level]) return;

    const line = formatMessage(msgLevel, args);
    process.stdout.write(`${line}\n`);

    ensureLogDir();
    appendFileSync(logFile, `${line}\n`);
  }

  return {
    debug: (...args: unknown[]) => log('debug', args),
    info: (...args: unknown[]) => log('info', args),
    warn: (...args: unknown[]) => log('warn', args),
    error: (...args: unknown[]) => log('error', args),
  };
}
