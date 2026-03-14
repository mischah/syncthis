import { CheckCircle, Repository } from 'iconoir-react';
import { useCallback, useEffect, useState } from 'react';
import { GitHubAuthFlow } from '../components/GitHubAuthFlow';
import { Toast } from '../components/Toast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';
import { shortenRemoteUrl } from '../lib/format-remote';
import { formatRelativeTime } from '../lib/format-time';

type WizardStep = 'connect' | 'repo' | 'folder' | 'done';
type WizardConflict = 'auto-both' | 'auto-newest' | 'ask';

interface SetupResult {
  dirPath: string;
  name: string;
  remote: string;
  interval: number;
  serviceStarted: boolean;
}

interface WizardState {
  step: WizardStep;
  githubConnected: boolean;
  githubUsername: string | null;
  selectedRepo: { name: string; cloneUrl: string } | null;
  manualUrl: string | null;
  mode: 'github' | 'manual';
  setupResult: SetupResult | null;
}

const INTERVAL_OPTIONS = [
  { seconds: 60, label: '1 minute' },
  { seconds: 120, label: '2 minutes' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
  { seconds: 900, label: '15 minutes' },
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '1 hour' },
] as const;

function formatIntervalHuman(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function extractRepoName(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1] || 'repo';
}

interface GitHubRepo {
  name: string;
  fullName: string;
  private: boolean;
  pushedAt: string;
  cloneUrl: string;
}

const STEPS: WizardStep[] = ['connect', 'repo', 'folder', 'done'];

function stepIndex(step: WizardStep): number {
  return STEPS.indexOf(step);
}

function StepIndicator({ current }: { current: WizardStep }) {
  const labels: Record<WizardStep, string> = {
    connect: t('wizard.step_connect'),
    repo: t('wizard.step_repo'),
    folder: t('wizard.step_folder'),
    done: t('wizard.step_done'),
  };
  const currentIdx = stepIndex(current);

  return (
    <div className="wizard-steps">
      {STEPS.map((step, i) => {
        const completed = i < currentIdx || (step === 'done' && current === 'done');
        const active = step === current && step !== 'done';
        const cls = active
          ? 'wizard-step wizard-step--active'
          : completed
            ? 'wizard-step wizard-step--done'
            : 'wizard-step wizard-step--future';
        return (
          <div key={step} className={cls}>
            <div className="wizard-step-dot">{completed ? '✓' : null}</div>
            <span className="wizard-step-label">{labels[step]}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConnectStep({
  wizState,
  manualInput,
  showAuthFlow,
  onManualInputChange,
  onShowAuthFlowChange,
  onGitHubConnected,
}: {
  wizState: WizardState;
  manualInput: string;
  showAuthFlow: boolean;
  onManualInputChange: (val: string) => void;
  onShowAuthFlowChange: (show: boolean) => void;
  onGitHubConnected: (result: { token: string; username: string }) => void;
}) {
  const isSsh = manualInput.startsWith('git@');

  return (
    <div className="wizard-step-content">
      {/* Primary: GitHub */}
      <div className="wizard-section">
        <h2 className="wizard-section-title">{t('wizard.connect_title')}</h2>
        <p className="settings-description">{t('wizard.connect_description')}</p>
        {wizState.githubConnected ? (
          <div className="wizard-connected">
            <span className="wizard-connected-check">✓</span>
            <span className="settings-label">
              {t('settings.github_connected').replace('{username}', wizState.githubUsername ?? '')}
            </span>
          </div>
        ) : showAuthFlow ? (
          <GitHubAuthFlow
            onSuccess={(result) => {
              onGitHubConnected(result);
              onShowAuthFlowChange(false);
            }}
            onCancel={() => onShowAuthFlowChange(false)}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => onShowAuthFlowChange(true)}>
            {t('wizard.connect_button')}
          </Button>
        )}
      </div>

      <div className="wizard-divider">
        <span className="wizard-divider-line" />
        <span className="wizard-divider-text">{t('wizard.connect_or')}</span>
        <span className="wizard-divider-line" />
      </div>

      {/* Fallback: manual URL */}
      <div className="wizard-section">
        <label className="settings-label" htmlFor="wizard-manual-url">
          {t('wizard.manual_url_label')}
        </label>
        <input
          id="wizard-manual-url"
          type="text"
          className="settings-input wizard-url-input"
          placeholder={t('wizard.manual_url_placeholder')}
          value={manualInput}
          onChange={(e) => onManualInputChange(e.target.value)}
        />
        {isSsh ? (
          <p className="settings-description wizard-ssh-warn">{t('wizard.manual_url_ssh_hint')}</p>
        ) : (
          <p className="settings-hint-text">{t('wizard.manual_url_hint')}</p>
        )}
      </div>
    </div>
  );
}

function slugify(input: string): string {
  return input
    .replace(/ä/g, 'ae')
    .replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe')
    .replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9._\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]|[-.]$/g, '')
    .slice(0, 100);
}

function RepoStep({
  selectedRepo,
  onSelect,
}: {
  selectedRepo: { name: string; cloneUrl: string } | null;
  onSelect: (repo: { name: string; cloneUrl: string }) => void;
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [repoMode, setRepoMode] = useState<'list' | 'create'>('list');
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchRepos = useCallback(() => {
    setLoading(true);
    setError(null);
    window.syncthis
      .invoke('github:list-repos', undefined)
      .then((data) => {
        setRepos(data);
        setLoading(false);
      })
      .catch(() => {
        setError(t('wizard.repo_error'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const filtered = repos.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));
  const slug = slugify(createName);

  async function handleCreate() {
    if (!slug || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const repo = await window.syncthis.invoke('github:create-repo', { name: slug });
      setCreateName('');
      setRepos((prev) => [
        {
          name: repo.name,
          fullName: repo.fullName,
          private: repo.private,
          pushedAt: repo.pushedAt,
          cloneUrl: repo.cloneUrl,
        },
        ...prev,
      ]);
      setRepoMode('list');
      setToast(t('wizard.repo_created_toast'));
      onSelect({ name: repo.name, cloneUrl: repo.cloneUrl });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('wizard.repo_create_error'));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="wizard-step-content">
        <h2 className="wizard-section-title">{t('wizard.repo_title')}</h2>
        <div className="wizard-repo-loading">
          <span className="github-auth-spinner" />
          <span className="settings-description">{t('wizard.repo_loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wizard-step-content">
        <h2 className="wizard-section-title">{t('wizard.repo_title')}</h2>
        <p className="settings-error-text">{error}</p>
      </div>
    );
  }

  if (repoMode === 'create') {
    return (
      <div className="wizard-step-content">
        <Button
          variant="ghost"
          size="sm"
          className="wizard-create-back"
          onClick={() => {
            setRepoMode('list');
            setCreateName('');
            setCreateError(null);
          }}
        >
          {t('wizard.repo_create_back')}
        </Button>
        <div className="wizard-section">
          <label className="settings-label" htmlFor="wizard-create-name">
            {t('wizard.repo_create_label')}
          </label>
          <input
            id="wizard-create-name"
            type="text"
            className="settings-input"
            value={createName}
            onChange={(e) => {
              setCreateName(e.target.value);
              setCreateError(null);
            }}
          />
          {slug && (
            <p className="settings-hint-text">
              {t('wizard.repo_create_slug').replace('{slug}', slug)}
            </p>
          )}
          {createError && <p className="settings-error-text">{createError}</p>}
          <div className="wizard-create-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={!slug || creating}
              onClick={() => void handleCreate()}
            >
              {t('wizard.repo_create_button')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-repo-step">
      <div className="wizard-repo-header">
        <h2 className="wizard-section-title">{t('wizard.repo_title')}</h2>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={() => setRepoMode('create')}
        >
          <Repository width={14} height={14} />
          {t('wizard.repo_new_button')}
        </Button>
      </div>
      <input
        type="text"
        className="settings-input wizard-url-input"
        placeholder={t('wizard.repo_filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="settings-description wizard-repo-empty">
          {filter ? t('wizard.repo_no_match') : t('wizard.repo_empty')}
        </p>
      ) : (
        <div className="wizard-repo-list">
          {filtered.map((repo) => (
            <button
              key={repo.fullName}
              type="button"
              className={`wizard-repo-row${selectedRepo?.cloneUrl === repo.cloneUrl ? ' wizard-repo-row--selected' : ''}`}
              onClick={() => onSelect({ name: repo.name, cloneUrl: repo.cloneUrl })}
            >
              <span className="wizard-repo-name">{repo.name}</span>
              <Badge
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-tertiary)',
                  border: '1px solid var(--border-default)',
                  flexShrink: 0,
                }}
              >
                {t('wizard.repo_private')}
              </Badge>
              <span className="wizard-repo-time">{formatRelativeTime(repo.pushedAt)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="settings-hint-text wizard-repo-hint">{t('wizard.repo_private_only')}</p>
      {toast && <Toast message={toast} variant="success" onDone={() => setToast(null)} />}
    </div>
  );
}

function FolderStep({
  repoUrl,
  repoName,
  useOAuth,
  onComplete,
}: {
  repoUrl: string;
  repoName: string;
  useOAuth: boolean;
  onComplete: (result: SetupResult) => void;
}) {
  const defaultClonePath = `~/Documents/${repoName}`;
  const [initMode, setInitMode] = useState<'clone' | 'existing'>('clone');
  const [folderPath, setFolderPath] = useState(defaultClonePath);
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [onConflict, setOnConflict] = useState<WizardConflict>('auto-both');
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    window.syncthis
      .invoke('app:settings-read', undefined)
      .then((settings) => {
        setIntervalSeconds(settings.defaults.interval);
        setOnConflict(settings.defaults.onConflict);
      })
      .catch(() => {});
  }, []);

  async function handleBrowse() {
    const picked = await window.syncthis.invoke('app:open-folder-picker', undefined);
    if (picked) {
      setFolderPath(picked);
      setInitMode('existing');
    }
  }

  async function handleSetup() {
    if (!folderPath.trim() || settingUp) return;
    setSettingUp(true);
    setSetupError(null);
    try {
      const result = await window.syncthis.invoke('folders:add', {
        mode: initMode,
        repoUrl,
        dirPath: folderPath.trim(),
        interval: intervalSeconds,
        onConflict,
        useOAuth,
      });
      onComplete(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setSetupError(t('wizard.setup_failed').replace('{message}', msg));
    } finally {
      setSettingUp(false);
    }
  }

  const conflictDescription: Record<string, string> = {
    'auto-both': t('settings.on_conflict_description.auto_both'),
    'auto-newest': t('settings.on_conflict_description.auto_newest'),
    ask: t('settings.on_conflict_description.ask'),
  };

  return (
    <div className="wizard-step-content">
      <h2 className="wizard-section-title">{t('wizard.folder_title')}</h2>

      {/* Clone vs Existing */}
      <div className="wizard-section">
        <label className="wizard-radio-option">
          <input
            type="radio"
            checked={initMode === 'clone'}
            onChange={() => {
              setInitMode('clone');
              setFolderPath(defaultClonePath);
            }}
          />
          <div>
            <span className="settings-label">{t('wizard.clone_option')}</span>
            <p className="settings-hint-text">{t('wizard.clone_description')}</p>
          </div>
        </label>
        <label className="wizard-radio-option">
          <input
            type="radio"
            checked={initMode === 'existing'}
            onChange={() => {
              setInitMode('existing');
              setFolderPath('');
            }}
          />
          <div>
            <span className="settings-label">{t('wizard.existing_option')}</span>
            <p className="settings-hint-text">{t('wizard.existing_description')}</p>
          </div>
        </label>
      </div>

      {/* Location */}
      <div className="wizard-section">
        <label className="settings-label" htmlFor="wizard-folder-path">
          {t('wizard.location')}
        </label>
        <div className="wizard-location-row">
          <input
            id="wizard-folder-path"
            type="text"
            className="settings-input"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => void handleBrowse()}>
            {t('wizard.browse')}
          </Button>
        </div>
      </div>

      {/* Schedule */}
      <div className="wizard-section">
        <label className="settings-label" htmlFor="wizard-interval">
          {t('wizard.schedule_label')}
        </label>
        <div className="wizard-interval-row">
          <span className="settings-description">{t('wizard.schedule_every')}</span>
          <select
            id="wizard-interval"
            className="settings-select"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.seconds} value={opt.seconds}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Conflict strategy */}
      <div className="wizard-section">
        <label className="settings-label" htmlFor="wizard-conflict">
          {t('wizard.conflict_label')}
        </label>
        <select
          id="wizard-conflict"
          className="settings-select settings-select--full"
          value={onConflict}
          onChange={(e) => setOnConflict(e.target.value as WizardConflict)}
        >
          <option value="auto-both">{t('conflict_mode.auto_both')}</option>
          <option value="auto-newest">{t('conflict_mode.auto_newest')}</option>
          <option value="ask">{t('conflict_mode.ask')}</option>
        </select>
        <p className="settings-hint-text">{conflictDescription[onConflict]}</p>
      </div>

      {/* Error */}
      {setupError && <p className="settings-error-text">{setupError}</p>}

      {/* Set up button */}
      <div className="wizard-create-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={!folderPath.trim() || settingUp}
          onClick={() => void handleSetup()}
        >
          {settingUp ? t('wizard.setting_up') : t('wizard.setup_button')}
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  result,
  onDone,
  onAddAnother,
}: {
  result: SetupResult;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  return (
    <div className="wizard-done-step">
      <CheckCircle className="wizard-done-icon" width={48} height={48} />
      <h2 className="wizard-section-title">{t('wizard.done_title')}</h2>
      <p className="settings-description">
        {t('wizard.done_description')
          .replace('{name}', result.name)
          .replace('{interval}', formatIntervalHuman(result.interval))
          .replace('{remote}', shortenRemoteUrl(result.remote))}
      </p>
      {!result.serviceStarted && (
        <p className="settings-error-text">{t('wizard.done_service_warning')}</p>
      )}
      <p className="settings-hint-text">{t('wizard.done_hint')}</p>
      <Button variant="ghost" size="xs" onClick={onDone}>
        {t('wizard.done_button')}
      </Button>
      <div className="wizard-divider">
        <span className="wizard-divider-line" />
        <span className="wizard-divider-text">{t('wizard.connect_or')}</span>
        <span className="wizard-divider-line" />
      </div>
      <Button variant="ghost" size="xs" onClick={onAddAnother}>
        {t('wizard.add_another')}
      </Button>
    </div>
  );
}

export function SetupWizard() {
  const { setView, setActiveFolder, refreshFolders } = useAppContext();
  const [wizState, setWizState] = useState<WizardState | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [showAuthFlow, setShowAuthFlow] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Check GitHub status on mount to determine starting step
  useEffect(() => {
    window.syncthis
      .invoke('github:status', undefined)
      .then(({ connected, username }) => {
        setWizState({
          step: connected ? 'repo' : 'connect',
          githubConnected: connected,
          githubUsername: username ?? null,
          selectedRepo: null,
          manualUrl: null,
          mode: 'github',
          setupResult: null,
        });
      })
      .catch(() => {
        setWizState({
          step: 'connect',
          githubConnected: false,
          githubUsername: null,
          selectedRepo: null,
          manualUrl: null,
          mode: 'github',
          setupResult: null,
        });
      });
  }, []);

  const handleBack = useCallback(() => {
    if (!wizState) return;
    const { step, mode } = wizState;
    if (step === 'connect') {
      setView('detail');
      return;
    }
    if (step === 'repo') {
      setWizState((prev) => (prev ? { ...prev, step: 'connect' } : prev));
      return;
    }
    if (step === 'folder') {
      const prevStep: WizardStep = mode === 'github' ? 'repo' : 'connect';
      setWizState((prev) => (prev ? { ...prev, step: prevStep } : prev));
    }
  }, [wizState, setView]);

  const handleSetupComplete = useCallback((result: SetupResult) => {
    setWizState((prev) => (prev ? { ...prev, step: 'done', setupResult: result } : prev));
  }, []);

  const handleDone = useCallback(async () => {
    if (!wizState?.setupResult) return;
    await refreshFolders();
    setActiveFolder(wizState.setupResult.dirPath);
    setView('detail');
  }, [wizState, refreshFolders, setActiveFolder, setView]);

  const handleAddAnother = useCallback(() => {
    setWizState((prev) => ({
      step: prev?.githubConnected ? 'repo' : 'connect',
      githubConnected: prev?.githubConnected ?? false,
      githubUsername: prev?.githubUsername ?? null,
      selectedRepo: null,
      manualUrl: null,
      mode: 'github',
      setupResult: null,
    }));
    setManualInput('');
  }, []);

  const handleNext = useCallback(async () => {
    if (!wizState) return;
    const { step, githubConnected, selectedRepo } = wizState;

    if (step === 'connect') {
      const url = manualInput.trim();
      if (url) {
        setValidating(true);
        setValidationError(null);
        try {
          const result = await window.syncthis.invoke('git:validate-remote', { url });
          if (result.valid) {
            setWizState((prev) =>
              prev ? { ...prev, step: 'folder', mode: 'manual', manualUrl: url } : prev,
            );
          } else {
            setValidationError(t('wizard.manual_url_invalid'));
          }
        } catch {
          setValidationError(t('wizard.manual_url_invalid'));
        } finally {
          setValidating(false);
        }
      } else if (githubConnected) {
        setWizState((prev) => (prev ? { ...prev, step: 'repo' } : prev));
      }
      return;
    }

    if (step === 'repo') {
      if (selectedRepo) {
        setWizState((prev) => (prev ? { ...prev, step: 'folder' } : prev));
      }
    }
  }, [wizState, manualInput]);

  if (!wizState) {
    return (
      <div className="wizard-loading">
        <span className="github-auth-spinner" />
      </div>
    );
  }

  const canGoNext = (() => {
    const { step, githubConnected, selectedRepo } = wizState;
    const url = manualInput.trim();
    if (step === 'connect') return githubConnected || url.length > 0;
    if (step === 'repo') return selectedRepo !== null;
    return false;
  })();

  return (
    <div className="wizard">
      <div className="wizard-header">
        <h1 className="wizard-title">{t('wizard.title')}</h1>
      </div>

      <StepIndicator current={wizState.step} />

      <div className="wizard-body">
        {wizState.step === 'connect' && (
          <ConnectStep
            wizState={wizState}
            manualInput={manualInput}
            showAuthFlow={showAuthFlow}
            onManualInputChange={(val) => {
              setManualInput(val);
              setValidationError(null);
            }}
            onShowAuthFlowChange={setShowAuthFlow}
            onGitHubConnected={({ username }) => {
              setWizState((prev) =>
                prev ? { ...prev, githubConnected: true, githubUsername: username } : prev,
              );
            }}
          />
        )}

        {wizState.step === 'repo' && (
          <RepoStep
            selectedRepo={wizState.selectedRepo}
            onSelect={(repo) =>
              setWizState((prev) => (prev ? { ...prev, selectedRepo: repo } : prev))
            }
          />
        )}

        {wizState.step === 'folder' && (
          <FolderStep
            repoUrl={
              wizState.mode === 'github'
                ? (wizState.selectedRepo?.cloneUrl ?? '')
                : (wizState.manualUrl ?? '')
            }
            repoName={
              wizState.mode === 'github'
                ? (wizState.selectedRepo?.name ?? 'repo')
                : extractRepoName(wizState.manualUrl ?? '')
            }
            useOAuth={wizState.mode === 'github' && wizState.githubConnected}
            onComplete={handleSetupComplete}
          />
        )}

        {wizState.step === 'done' && wizState.setupResult && (
          <DoneStep
            result={wizState.setupResult}
            onDone={() => void handleDone()}
            onAddAnother={handleAddAnother}
          />
        )}
      </div>

      {validating && (
        <div className="wizard-validating">
          <span className="github-auth-spinner" />
          <span className="settings-description">{t('wizard.manual_url_validating')}</span>
        </div>
      )}
      {validationError && <p className="settings-error-text">{validationError}</p>}

      {wizState.step !== 'done' && (
        <div className="wizard-nav">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            {t('wizard.back')}
          </Button>
          {wizState.step !== 'folder' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canGoNext || validating}
              onClick={() => void handleNext()}
            >
              {t('wizard.next')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
