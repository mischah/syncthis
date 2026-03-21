import type { SyncthisConfig } from '@syncthis/shared';
import { t } from '../i18n';

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return t('status.service_stopped');
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time.just_now');
  if (mins < 60) return t('time.minutes_ago', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('time.hours_ago', { n: hours });
  return t('time.days_ago', { n: Math.floor(hours / 24) });
}

export function formatSchedule(config: SyncthisConfig): string {
  if (config.interval !== null && config.interval !== undefined) {
    const mins = Math.floor(config.interval / 60);
    if (mins <= 1) return t('schedule.every_minute');
    if (mins < 60) return t('schedule.every_n_minutes', { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours === 1) return t('schedule.every_hour');
    return t('schedule.every_n_hours', { n: hours });
  }
  if (config.cron) {
    const parts = config.cron.trim().split(/\s+/);
    if (parts.length === 5) {
      const [minute, hour] = parts;
      const [, , dom, month, dow] = parts;
      if (dom === '*' && month === '*' && dow === '*') {
        if (hour === '*') {
          if (minute === '*') return t('schedule.every_minute');
          if (minute.startsWith('*/')) {
            const n = Number(minute.slice(2));
            return n <= 1 ? t('schedule.every_minute') : t('schedule.every_n_minutes', { n });
          }
        }
        if (minute === '0') {
          if (hour === '*') return t('schedule.every_hour');
          if (hour.startsWith('*/')) {
            const n = Number(hour.slice(2));
            return n <= 1 ? t('schedule.every_hour') : t('schedule.every_n_hours', { n });
          }
          if (hour === '0') return t('schedule.every_day');
        }
      }
    }
    return config.cron;
  }
  return '';
}
