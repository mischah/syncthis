import { Xmark } from 'iconoir-react';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';

export function UpdateBanner() {
  const { state, dismissUpdate } = useAppContext();
  const { updateAvailable } = state;

  if (!updateAvailable) return null;

  const { releaseUrl, version, downloaded } = updateAvailable;

  function handleAction() {
    if (downloaded) {
      void window.syncthis.invoke('app:restart-and-update', undefined);
    } else {
      void window.syncthis.invoke('app:open-release-page', { url: releaseUrl });
    }
  }

  function handleDismiss() {
    void dismissUpdate(version);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--accent-bg)',
        color: 'var(--accent)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--space-4)',
        flexShrink: 0,
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>
        {downloaded ? t('update.banner_ready', { version }) : t('update.banner', { version })}
      </span>
      <button
        type="button"
        onClick={handleAction}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontWeight: 500,
          fontSize: 13,
          padding: '0 var(--space-1)',
          textDecoration: 'underline',
        }}
      >
        {downloaded ? t('update.restart') : t('update.download')}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('update.dismiss')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: 2,
          opacity: 0.7,
        }}
      >
        <Xmark width={14} height={14} strokeWidth={2} />
      </button>
    </div>
  );
}
