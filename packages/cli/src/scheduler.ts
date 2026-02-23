import { Cron } from 'croner';
import type { SyncthisConfig } from './config.js';

export interface SchedulerHandle {
  stop(): void;
}

export function startScheduler(
  config: SyncthisConfig,
  syncFn: () => Promise<void>,
): SchedulerHandle {
  let isRunning = false;

  async function runIfIdle(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    try {
      await syncFn();
    } finally {
      isRunning = false;
    }
  }

  if (config.cron !== null) {
    const job = new Cron(config.cron, () => {
      void runIfIdle();
    });
    return { stop: () => job.stop() };
  }

  const intervalMs = (config.interval ?? 0) * 1000;
  const handle = setInterval(() => {
    void runIfIdle();
  }, intervalMs);
  return { stop: () => clearInterval(handle) };
}
