import type { FolderSummary } from '@syncthis/shared';
import { AppWindow, Plus, RefreshDouble, Settings } from 'iconoir-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../renderer/i18n/index.js';
import { shortenPath } from '../renderer/lib/format-remote.js';
import './popover.css';

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return t('status.service_stopped');
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time.just_now');
  if (mins < 60) return t('time.minutes_ago', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('time.hours_ago', { n: hours });
  const days = Math.floor(hours / 24);
  return t('time.days_ago', { n: days });
}

function statusDotColor(folder: FolderSummary): string {
  if (!folder.health.serviceRunning) return 'var(--text-secondary)';
  if (folder.health.level === 'healthy') return 'var(--status-healthy)';
  if (folder.health.level === 'degraded') return 'var(--status-warning)';
  return 'var(--status-error)';
}

function FolderRow({ folder }: { folder: FolderSummary }) {
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncing(true);
    try {
      await window.syncthis.invoke('service:sync-now', { dirPath: folder.dirPath });
    } finally {
      setSyncing(false);
    }
  }

  function handleRowClick() {
    window.syncthis.invoke('app:open-dashboard', undefined);
  }

  const dotColor = statusDotColor(folder);
  const syncDisabled = syncing || !folder.health.serviceRunning;

  return (
    <div className="folder-row">
      <button type="button" className="folder-row-content" onClick={handleRowClick}>
        <div className="folder-row-name">
          <span className="status-dot" style={{ backgroundColor: dotColor }} />
          <span className="folder-name">{folder.name}</span>
        </div>
        <div className="folder-path">{shortenPath(folder.dirPath)}</div>
      </button>
      <span
        className={`folder-sync-time${!folder.health.serviceRunning ? ' folder-sync-time--stopped' : ''}`}
      >
        {formatRelativeTime(folder.health.lastSync)}
      </span>
      <button
        type="button"
        className="sync-btn"
        onClick={handleSyncNow}
        disabled={syncDisabled}
        title={t('action.sync_now')}
      >
        <RefreshDouble width={16} height={16} />
      </button>
    </div>
  );
}

export function Popover() {
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.syncthis.invoke('folders:list', undefined).then(setFolders);

    const interval = setInterval(() => {
      window.syncthis.invoke('health:all', undefined).then((healths) => {
        setFolders((prev) =>
          prev.map((f) => {
            const h = healths.find((hh) => hh.dirPath === f.dirPath);
            return h ? { ...f, health: h } : f;
          }),
        );
      });
    }, 10000);

    const unsubService = window.syncthis.on('service:state-changed', () => {
      window.syncthis.invoke('folders:list', undefined).then(setFolders);
    });

    const unsubHealth = window.syncthis.on('health:changed', (data) => {
      setFolders((prev) =>
        prev.map((f) => (f.dirPath === data.dirPath ? { ...f, health: data } : f)),
      );
    });

    return () => {
      clearInterval(interval);
      unsubService();
      unsubHealth();
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const height = containerRef.current.scrollHeight;
      window.syncthis.invoke('app:resize-popover', { height });
    }
  });

  function handleAddFolder() {
    window.syncthis.invoke('app:open-dashboard', { view: 'setup' });
  }

  function handleOpen() {
    window.syncthis.invoke('app:open-dashboard', undefined);
  }

  return (
    <div ref={containerRef} className="popover-container">
      <header className="popover-header">
        <span className="popover-title">{t('app.name')}</span>
        <button
          type="button"
          className="popover-settings-btn"
          onClick={() => window.syncthis.invoke('app:open-dashboard', { view: 'settings' })}
          title={t('action.settings')}
        >
          <Settings width={14} height={14} />
        </button>
      </header>

      {folders.length === 0 ? (
        <div className="popover-empty">
          <p>{t('status.no_folders')}</p>
        </div>
      ) : (
        <div className="popover-list">
          {folders.map((folder) => (
            <FolderRow key={folder.dirPath} folder={folder} />
          ))}
        </div>
      )}

      <footer className="popover-footer">
        <button type="button" className="popover-footer-btn" onClick={handleAddFolder}>
          <Plus width={14} height={14} />
          <span>{t('popover.footer.add')}</span>
        </button>
        <button type="button" className="popover-footer-btn" onClick={handleOpen}>
          <AppWindow width={14} height={14} />
          {t('popover.footer.open')}
        </button>
      </footer>
    </div>
  );
}
