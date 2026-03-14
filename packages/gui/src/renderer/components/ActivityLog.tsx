import type { LogEntry } from '@syncthis/shared';
import { CheckCircle, GitPullRequestClosed, WarningTriangle, XmarkCircle } from 'iconoir-react';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { Button } from './ui/button';
import './ActivityLog.css';

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function describe(entry: LogEntry): string {
  switch (entry.type) {
    case 'synced': {
      const match = /(\d+) files? changed/.exec(entry.message);
      const details = match
        ? `${match[1]} file${match[1] === '1' ? '' : 's'} changed`
        : entry.message;
      return t('activity.synced', { details });
    }
    case 'synced-no-changes':
      return t('activity.synced_no_changes');
    case 'pulled':
      return t('activity.pulled');
    case 'push-failed': {
      const idx = entry.message.toLowerCase().indexOf('push failed');
      const raw =
        idx >= 0
          ? entry.message
              .slice(idx + 'push failed'.length)
              .replace(/^[:\s]+/, '')
              .trim()
          : '';
      const details = raw || entry.message;
      return t('activity.push_failed', { details });
    }
    case 'conflict':
      return t('activity.conflict');
    case 'started':
      return t('activity.started');
    case 'error':
      return t('activity.error', { details: entry.message });
    default:
      return entry.message;
  }
}

function EntryIcon({ entry }: { entry: LogEntry }) {
  const { type, level } = entry;
  if (type === 'push-failed' || (type === 'other' && level === 'warn')) {
    return (
      <WarningTriangle
        className="activity-icon"
        width={16}
        height={16}
        style={{ color: 'var(--status-warning)' }}
      />
    );
  }
  if (type === 'error' || type === 'conflict' || (type === 'other' && level === 'error')) {
    const Icon = type === 'conflict' ? GitPullRequestClosed : XmarkCircle;
    return (
      <Icon
        className="activity-icon"
        width={16}
        height={16}
        style={{ color: 'var(--status-error)' }}
      />
    );
  }
  return (
    <CheckCircle
      className="activity-icon"
      width={16}
      height={16}
      style={{ color: 'var(--status-healthy)' }}
    />
  );
}

export function ActivityLog({ dirPath }: { dirPath: string }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [newestTimestamp, setNewestTimestamp] = useState<string | null>(null);
  const [overflows, setOverflows] = useState(false);

  const listRef = useCallback((el: HTMLUListElement | null) => {
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true });
    // Cleanup handled by element unmount (loading/dirPath change remounts)
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExpanded(false);
    setNewestTimestamp(null);

    window.syncthis
      .invoke('logs:recent', { dirPath, maxLines: 20 })
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    window.syncthis.invoke('logs:subscribe', { dirPath }).catch(() => {});

    const unsub = window.syncthis.on('logs:line', ({ dirPath: d, entry }) => {
      if (d === dirPath) {
        setEntries((prev) => [entry, ...prev].slice(0, 100));
        setNewestTimestamp(entry.timestamp);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      window.syncthis.invoke('logs:unsubscribe', { dirPath }).catch(() => {});
    };
  }, [dirPath]);

  async function handleShowFullLog() {
    const result = await window.syncthis.invoke('logs:recent', { dirPath, maxLines: 100 });
    setEntries(result);
    setExpanded(true);
  }

  if (loading) {
    return (
      <div className="activity-root">
        <div className="activity-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="activity-entry activity-skeleton">
              <span className="activity-time activity-skeleton-block" style={{ width: 32 }} />
              <span
                className="activity-skeleton-block"
                style={{ width: 16, height: 16, borderRadius: '50%' }}
              />
              <span className="activity-skeleton-block" style={{ flex: 1 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="activity-root">
        <p className="activity-empty">{t('activity.no_activity')}</p>
      </div>
    );
  }

  return (
    <div className="activity-root">
      <ul ref={listRef} className={`activity-list${overflows ? ' activity-list--overflows' : ''}`}>
        {entries.map((entry, i) => (
          <li
            key={`${entry.timestamp}-${i}`}
            className={`activity-entry${entry.timestamp === newestTimestamp && i === 0 ? ' activity-entry--new' : ''}`}
          >
            <span className="activity-time">{formatTime(entry.timestamp)}</span>
            <EntryIcon entry={entry} />
            <span className="activity-message">{describe(entry)}</span>
          </li>
        ))}
      </ul>
      {!expanded && entries.length >= 20 && (
        <Button
          variant="ghost"
          size="sm"
          className="activity-show-more"
          onClick={() => {
            void handleShowFullLog();
          }}
        >
          {t('activity.show_full_log')}
        </Button>
      )}
    </div>
  );
}
