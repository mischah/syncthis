import type { FolderDetail } from '@syncthis/shared';
import {
  Folder,
  FolderPlus,
  Pause,
  Play,
  RefreshDouble,
  Settings,
  XmarkSquare,
} from 'iconoir-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityLog } from '../components/ActivityLog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import { TooltipProvider } from '../components/ui/tooltip';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';
import { shortenPath, shortenRemoteUrl } from '../lib/format-remote';
import { formatRelativeTime, formatSchedule } from '../lib/format-time';

function StatusBadge({ level }: { level: string }) {
  if (level === 'healthy') {
    return (
      <Badge
        style={{
          background: 'var(--status-healthy-bg)',
          color: 'var(--status-healthy)',
          border: '1px solid transparent',
        }}
      >
        {t('status.healthy')}
      </Badge>
    );
  }
  if (level === 'degraded') {
    return (
      <Badge
        style={{
          background: 'var(--status-warning-bg)',
          color: 'var(--status-warning)',
          border: '1px solid transparent',
        }}
      >
        {t('status.degraded')}
      </Badge>
    );
  }
  return <Badge variant="destructive">{t('status.unhealthy')}</Badge>;
}

function conflictModeLabel(mode: string): string {
  if (mode === 'auto-both') return t('conflict_mode.auto_both');
  if (mode === 'auto-newest') return t('conflict_mode.auto_newest');
  if (mode === 'ask') return t('conflict_mode.ask');
  if (mode === 'stop') return t('conflict_mode.stop');
  return mode;
}

export function DetailView() {
  const { state, refreshFolders, setView } = useAppContext();
  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const showSidebar = state.folders.length >= 2;

  const loadDetail = useCallback(async () => {
    if (!state.activeFolderPath) return;
    try {
      const d = await window.syncthis.invoke('folders:detail', {
        dirPath: state.activeFolderPath,
      });
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, [state.activeFolderPath]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleSyncNowRef = useRef(handleSyncNow);
  handleSyncNowRef.current = handleSyncNow;

  useEffect(() => {
    function listener() {
      handleSyncNowRef.current();
    }
    window.addEventListener('syncthis:sync-now', listener);
    return () => window.removeEventListener('syncthis:sync-now', listener);
  }, []);

  if (!state.activeFolderPath) {
    return (
      <div className="no-folders-state">
        <FolderPlus className="no-folders-icon" width={48} height={48} />
        <h2 className="no-folders-title">{t('empty.title')}</h2>
        <p className="settings-description">{t('empty.description')}</p>
        <Button variant="secondary" size="sm" onClick={() => setView('setup')}>
          {t('action.add_folder')}
        </Button>
      </div>
    );
  }

  if (!detail) {
    return <div className="detail-empty" />;
  }

  const { config, lastCommit } = detail;
  // Use health from AppContext (polled every 10s) so external changes are reflected
  const liveFolder = state.folders.find((f) => f.dirPath === state.activeFolderPath);
  const health = liveFolder?.health ?? detail.health;
  const isRunning = health.serviceRunning;

  async function handleSyncNow() {
    if (!state.activeFolderPath) return;
    setSyncing(true);
    try {
      await window.syncthis.invoke('service:sync-now', { dirPath: state.activeFolderPath });
      await loadDetail();
    } finally {
      setSyncing(false);
    }
  }

  async function handleStart() {
    if (!state.activeFolderPath) return;
    setStarting(true);
    try {
      await window.syncthis.invoke('service:start', { dirPath: state.activeFolderPath });
      let running = false;
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const health = await window.syncthis.invoke('health:status', {
          dirPath: state.activeFolderPath,
        });
        if (health.serviceRunning) {
          running = true;
          break;
        }
      }
      if (running) {
        await window.syncthis.invoke('service:broadcast-state', {
          dirPath: state.activeFolderPath,
          status: 'running',
        });
      }
      await refreshFolders();
      await loadDetail();
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!state.activeFolderPath) return;
    await window.syncthis.invoke('service:stop', { dirPath: state.activeFolderPath });
    await refreshFolders();
    await loadDetail();
  }

  async function handleOpenFolder() {
    if (!state.activeFolderPath) return;
    await window.syncthis.invoke('app:reveal-in-file-manager', {
      dirPath: state.activeFolderPath,
    });
  }

  async function handleRemove() {
    if (!state.activeFolderPath) return;
    setRemoveDialogOpen(false);
    await window.syncthis.invoke('folders:remove', { dirPath: state.activeFolderPath });
    await refreshFolders();
  }

  const remoteShort = shortenRemoteUrl(config.remote);

  function statusDescription(): string {
    if (!isRunning) {
      return health.lastSync
        ? t('status.synced', { time: formatRelativeTime(health.lastSync) })
        : t('status.never_synced');
    }
    if (health.consecutiveFailures > 0) {
      return t('status.failures', { n: health.consecutiveFailures });
    }
    return health.lastSync ? t('status.synced', { time: formatRelativeTime(health.lastSync) }) : '';
  }

  const statusDesc = statusDescription();

  return (
    <TooltipProvider>
      <div className="detail-view">
        <div className="detail-header">
          <h1 className="detail-title">{detail.name}</h1>
          <div className="detail-header-actions">
            {!showSidebar && (
              <Button variant="ghost" size="sm" onClick={() => setView('setup')}>
                <FolderPlus width={14} height={14} />
                &nbsp;
                {t('action.add_folder')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="detail-settings-btn"
              onClick={() => setView('settings')}
              title={t('action.settings')}
            >
              <Settings width={16} height={16} />
            </Button>
          </div>
        </div>

        <Separator />

        <div className="detail-status">
          <div className="detail-status-row">
            {isRunning ? (
              <StatusBadge level={health.level} />
            ) : (
              <Badge
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid transparent',
                }}
              >
                {t('status.stopped')}
              </Badge>
            )}
            {statusDesc && <span className="detail-sync-time">{statusDesc}</span>}
          </div>
          {health.level !== 'healthy' && health.reasons.length > 0 && (
            <ul className="detail-status-reasons">
              {health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        <dl className="detail-grid">
          <dt>{t('detail.path')}</dt>
          <dd className="detail-mono" title={detail.dirPath}>
            {shortenPath(detail.dirPath)}
          </dd>

          <dt>{t('detail.schedule')}</dt>
          <dd>{formatSchedule(config)}</dd>

          <dt>{t('detail.branch')}</dt>
          <dd className="detail-mono">{config.branch}</dd>

          <dt>{t('detail.remote')}</dt>
          <dd>
            <span className="detail-remote-short">{remoteShort}</span>
          </dd>

          <dt>{t('detail.conflict_mode')}</dt>
          <dd>{conflictModeLabel(config.onConflict)}</dd>

          {lastCommit && (
            <>
              <dt>{t('detail.last_commit')}</dt>
              <dd className="detail-commit">
                <span className="detail-commit-msg">{lastCommit.message}</span>
                <span className="detail-commit-time">{formatRelativeTime(lastCommit.date)}</span>
              </dd>
            </>
          )}
        </dl>

        <Separator />

        <div className="detail-activity">
          <h2 className="activity-heading">{t('activity.title')}</h2>
          <ActivityLog dirPath={state.activeFolderPath} />
        </div>

        <Separator />

        <div className="detail-actions">
          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={handleStop}>
              <Pause width={16} height={16} />
              &nbsp;
              {t('action.stop')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={starting} onClick={handleStart}>
              <Play width={16} height={16} />
              &nbsp;
              {t('action.start')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={syncing || !isRunning}
            onClick={handleSyncNow}
          >
            <RefreshDouble width={12} height={12} />
            &nbsp;
            {t('action.sync_now')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleOpenFolder}>
            <Folder width={14} height={14} />
            &nbsp;
            {t('action.open_folder')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="detail-uninstall-btn"
            onClick={() => setRemoveDialogOpen(true)}
          >
            <XmarkSquare width={14} height={14} />
            &nbsp;
            {t('action.remove')}
          </Button>
        </div>

        <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('confirm.remove.title')}</DialogTitle>
              <DialogDescription>
                {t('confirm.remove.body', { name: detail.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setRemoveDialogOpen(false)}
              >
                {t('action.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={handleRemove}
              >
                {t('confirm.remove.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
