import type { SyncthisConfig } from '@syncthis/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime, formatSchedule } from '../../src/renderer/lib/format-time';

const NOW = new Date('2025-06-01T12:00:00.000Z').getTime();

const config = (overrides: Partial<SyncthisConfig>): SyncthisConfig => ({
  remote: 'git@github.com:user/repo.git',
  branch: 'main',
  cron: null,
  interval: null,
  onConflict: 'auto-both',
  ...overrides,
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Service stopped" for null', () => {
    expect(formatRelativeTime(null)).toBe('Service stopped');
  });

  it('returns "just now" for < 1 minute ago', () => {
    const ts = new Date(NOW - 30_000).toISOString();
    expect(formatRelativeTime(ts)).toBe('just now');
  });

  it('returns minutes for < 1 hour ago', () => {
    const ts = new Date(NOW - 5 * 60_000).toISOString();
    expect(formatRelativeTime(ts)).toBe('5m ago');
  });

  it('returns hours for < 24 hours ago', () => {
    const ts = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(ts)).toBe('3h ago');
  });

  it('returns days for >= 24 hours ago', () => {
    const ts = new Date(NOW - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(ts)).toBe('2d ago');
  });
});

describe('formatSchedule', () => {
  describe('interval mode', () => {
    it('returns "every minute" for interval <= 60s', () => {
      expect(formatSchedule(config({ interval: 60 }))).toBe('every minute');
    });

    it('returns "every N minutes" for < 1 hour', () => {
      expect(formatSchedule(config({ interval: 300 }))).toBe('every 5 minutes');
    });

    it('returns "every hour" for 3600s', () => {
      expect(formatSchedule(config({ interval: 3600 }))).toBe('every hour');
    });

    it('returns "every N hours" for > 1 hour', () => {
      expect(formatSchedule(config({ interval: 7200 }))).toBe('every 2 hours');
    });
  });

  describe('cron mode', () => {
    it('returns "every minute" for * * * * *', () => {
      expect(formatSchedule(config({ cron: '* * * * *' }))).toBe('every minute');
    });

    it('returns "every N minutes" for */N * * * *', () => {
      expect(formatSchedule(config({ cron: '*/5 * * * *' }))).toBe('every 5 minutes');
    });

    it('returns "every hour" for 0 * * * *', () => {
      expect(formatSchedule(config({ cron: '0 * * * *' }))).toBe('every hour');
    });

    it('returns "every N hours" for 0 */N * * *', () => {
      expect(formatSchedule(config({ cron: '0 */2 * * *' }))).toBe('every 2 hours');
    });

    it('returns "every day" for 0 0 * * *', () => {
      expect(formatSchedule(config({ cron: '0 0 * * *' }))).toBe('every day');
    });

    it('returns the raw cron string for complex expressions', () => {
      expect(formatSchedule(config({ cron: '0 9 * * 1' }))).toBe('0 9 * * 1');
    });
  });

  it('returns empty string when neither interval nor cron is set', () => {
    expect(formatSchedule(config({ cron: null, interval: null }))).toBe('');
  });
});
