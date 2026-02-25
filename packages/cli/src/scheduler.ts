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

  // Recursive setTimeout instead of setInterval: each tick schedules the next
  // only after syncFn completes. This survives OS sleep/wake cycles, where
  // setInterval timers can silently stop firing.
  const intervalMs = (config.interval ?? 0) * 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  function tick(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void runIfIdle().then(tick);
    }, intervalMs);
  }
  tick();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
