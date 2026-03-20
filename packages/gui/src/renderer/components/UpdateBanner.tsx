import { Xmark } from 'iconoir-react';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';

export function UpdateBanner() {
  const { state, dismissUpdate } = useAppContext();
  const { updateAvailable } = state;

  if (!updateAvailable) return null;

  const { releaseUrl, version } = updateAvailable;

  function handleDownload() {
    void window.syncthis.invoke('app:open-release-page', { url: releaseUrl });
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
      <span style={{ flex: 1 }}>{t('update.banner', { version: updateAvailable.version })}</span>
      <button
        type="button"
        onClick={handleDownload}
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
        {t('update.download')}
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
