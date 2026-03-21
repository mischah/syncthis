import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Button } from './ui/button';

interface GitHubAuthFlowProps {
  onSuccess: (result: { token: string; username: string }) => void;
  onCancel?: () => void;
}

type FlowState =
  | { phase: 'loading' }
  | {
      phase: 'awaiting';
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      interval: number;
    }
  | { phase: 'error'; message: string };

export function GitHubAuthFlow({ onSuccess, onCancel }: GitHubAuthFlowProps) {
  const [state, setState] = useState<FlowState>({ phase: 'loading' });
  const [copied, setCopied] = useState(false);
  const onSuccessRef = useRef(onSuccess);
  const hasStarted = useRef(false);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  const startAuth = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await window.syncthis.invoke('github:start-auth', undefined);
      setState({
        phase: 'awaiting',
        userCode: res.userCode,
        verificationUri: res.verificationUri,
        deviceCode: res.deviceCode,
        interval: res.interval,
      });
    } catch {
      setState({ phase: 'error', message: t('github.error_generic') });
    }
  }, []);

  // Guard against React StrictMode double-invoking this effect, which would
  // fire two github:start-auth IPC calls and open two browser tabs. The ref
  // persists across the double-invoke since the component instance is reused.
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void startAuth();
  }, [startAuth]);

  useEffect(() => {
    if (state.phase !== 'awaiting') return;
    const { deviceCode, interval } = state;

    const id = setInterval(async () => {
      try {
        const result = await window.syncthis.invoke('github:poll-auth', { deviceCode, interval });
        if (result.status === 'complete') {
          clearInterval(id);
          onSuccessRef.current({ token: result.token, username: result.username });
        } else if (result.status === 'error') {
          clearInterval(id);
          const msg = result.message.includes('expired')
            ? t('github.error_expired')
            : result.message.includes('denied')
              ? t('github.error_denied')
              : t('github.error_generic');
          setState({ phase: 'error', message: msg });
        } else if (result.newInterval) {
          // GitHub asked us to slow down — recreate the interval with the new cadence
          clearInterval(id);
          const newInterval = result.newInterval;
          setState((prev) =>
            prev.phase === 'awaiting' ? { ...prev, interval: newInterval } : prev,
          );
        }
      } catch {
        // network error — keep polling
      }
    }, interval * 1000);

    return () => clearInterval(id);
  }, [state]);

  async function handleCopy() {
    if (state.phase !== 'awaiting') return;
    await navigator.clipboard.writeText(state.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleOpenAgain() {
    if (state.phase !== 'awaiting') return;
    await window.syncthis.invoke('github:open-auth-page', { url: state.verificationUri });
  }

  if (state.phase === 'loading') {
    return (
      <div className="github-auth-loading">
        <span className="github-auth-spinner" />
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="github-auth-error">
        <p className="settings-description">{state.message}</p>
        <div className="github-auth-error-actions">
          <Button variant="secondary" size="sm" onClick={() => void startAuth()}>
            {t('github.try_again')}
          </Button>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('action.cancel')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="github-auth-flow">
      <p className="settings-label">{t('github.auth_title')}</p>
      <p className="github-auth-code">{state.userCode}</p>
      <p className="settings-description">{t('github.auth_instruction')}</p>
      <div className="github-auth-actions">
        <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
          {copied ? t('github.code_copied') : t('github.copy_code')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void handleOpenAgain()}>
          {t('github.open_again')}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
        )}
      </div>
      <div className="github-auth-waiting">
        <span className="github-auth-spinner" />
        <span className="settings-description">{t('github.waiting')}</span>
      </div>
    </div>
  );
}
