import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Cached result of notify-send availability check on Linux
let notifySendAvailable: boolean | null = null;

function escapeOsascript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function checkNotifySend(): Promise<boolean> {
  if (notifySendAvailable !== null) return notifySendAvailable;
  try {
    await execFileAsync('which', ['notify-send'], {
      signal: AbortSignal.timeout(5000),
    });
    notifySendAvailable = true;
  } catch {
    notifySendAvailable = false;
  }
  return notifySendAvailable;
}

export async function sendDesktopNotification(title: string, message: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      const t = escapeOsascript(title);
      const m = escapeOsascript(message);
      await execFileAsync('osascript', ['-e', `display notification "${m}" with title "${t}"`], {
        signal: AbortSignal.timeout(5000),
      });
    } else if (process.platform === 'linux') {
      const available = await checkNotifySend();
      if (!available) return;
      await execFileAsync('notify-send', [title, message], {
        signal: AbortSignal.timeout(5000),
      });
    }
    // Other platforms: silent no-op
  } catch {
    // Fire-and-forget — errors silently swallowed
  }
}
