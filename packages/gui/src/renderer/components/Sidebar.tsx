import { CheckCircle, Plus, Settings, WarningTriangle, XmarkCircle } from 'iconoir-react';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';

function HealthIcon({ level, serviceRunning }: { level: string; serviceRunning: boolean }) {
  const style = { flexShrink: 0 } as const;
  if (!serviceRunning) {
    return (
      <XmarkCircle width={16} height={16} style={{ ...style, color: 'var(--text-secondary)' }} />
    );
  }
  if (level === 'healthy') {
    return (
      <CheckCircle width={16} height={16} style={{ ...style, color: 'var(--status-healthy)' }} />
    );
  }
  if (level === 'degraded') {
    return (
      <WarningTriangle
        width={16}
        height={16}
        style={{ ...style, color: 'var(--status-warning)' }}
      />
    );
  }
  return <XmarkCircle width={16} height={16} style={{ ...style, color: 'var(--status-error)' }} />;
}

export function Sidebar() {
  const { state, setActiveFolder } = useAppContext();

  function handleAddFolder() {
    window.syncthis.invoke('app:open-dashboard', undefined);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t('app.name')}</span>
      </div>
      <div className="sidebar-list">
        {state.folders.map((folder) => (
          <button
            key={folder.dirPath}
            type="button"
            className={`sidebar-row${state.activeFolderPath === folder.dirPath ? ' sidebar-row--active' : ''}`}
            onClick={() => setActiveFolder(folder.dirPath)}
          >
            <HealthIcon level={folder.health.level} serviceRunning={folder.health.serviceRunning} />
            <span className="sidebar-folder-name">{folder.name}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-separator" />
        <div className="sidebar-footer-row">
          <button type="button" className="sidebar-add-btn" onClick={handleAddFolder}>
            <Plus width={14} height={14} />
            {t('action.add_folder')}
          </button>
          <button type="button" className="sidebar-settings-btn" title={t('action.settings')}>
            <Settings width={16} height={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
