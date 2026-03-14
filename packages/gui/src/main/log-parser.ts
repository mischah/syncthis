import { closeSync, openSync, readSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry, LogEntryType } from '@syncthis/shared';

// Re-export types for convenience
export type { LogEntry, LogEntryType };

// [2025-01-01T12:00:00.000Z] [INFO]  message
// levelTag is padEnd(8): [INFO]  (2 spaces), [WARN]  (2 spaces), [ERROR] (1 space), [DEBUG] (1 space)
const LOG_LINE_RE = /^\[(.+?)\] \[(\w+)\]\s+(.+)$/;

function categorize(level: LogEntry['level'], message: string): LogEntryType {
  const msg = message.toLowerCase();
  if (msg.startsWith('sync started')) return 'started';
  if (msg.startsWith('sync cycle: no changes')) return 'synced-no-changes';
  if (msg.startsWith('sync cycle: pulled')) return 'pulled';
  if (msg.startsWith('sync cycle:') && msg.includes('files changed')) return 'synced';
  if (msg.includes('push failed')) return 'push-failed';
  if (msg.includes('conflict')) return 'conflict';
  if (level === 'error') return 'error';
  return 'other';
}

export function parseLogLine(line: string): LogEntry | null {
  const match = LOG_LINE_RE.exec(line);
  if (!match) return null;
  const [, timestamp, rawLevel, message] = match;
  const level = rawLevel.toLowerCase() as LogEntry['level'];
  if (!['debug', 'info', 'warn', 'error'].includes(level)) return null;
  return { timestamp, level, message, type: categorize(level, message) };
}

function logFilePath(dirPath: string): string {
  return join(dirPath, '.syncthis', 'logs', 'syncthis.log');
}

export async function readRecentLogs(dirPath: string, maxLines = 50): Promise<LogEntry[]> {
  try {
    const content = await readFile(logFilePath(dirPath), 'utf8');
    const lines = content.split('\n').filter((l) => l.trim() !== '');
    const recent = lines.slice(-maxLines);
    const entries: LogEntry[] = [];
    for (const line of recent) {
      const entry = parseLogLine(line);
      if (entry) entries.push(entry);
    }
    entries.reverse();
    return entries;
  } catch {
    return [];
  }
}

export function watchLogFile(dirPath: string, callback: (entry: LogEntry) => void): () => void {
  const filePath = logFilePath(dirPath);
  const logDir = join(dirPath, '.syncthis', 'logs');
  let lastSize = 0;

  try {
    lastSize = statSync(filePath).size;
  } catch {
    // file doesn't exist yet
  }

  function processNewContent(): void {
    try {
      const stat = statSync(filePath);
      if (stat.size <= lastSize) return;
      const fd = openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - lastSize);
        readSync(fd, buffer, 0, buffer.length, lastSize);
        lastSize = stat.size;
        for (const line of buffer.toString('utf8').split('\n')) {
          const entry = parseLogLine(line);
          if (entry) callback(entry);
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      // file may not exist yet or was rotated
    }
  }

  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(logDir, (_event, filename) => {
      if (filename === 'syncthis.log') processNewContent();
    });
  } catch {
    // log dir doesn't exist; try watching the file directly
    try {
      watcher = watch(filePath, () => processNewContent());
    } catch {
      // can't watch — return no-op unsubscribe
    }
  }

  return () => watcher?.close();
}
