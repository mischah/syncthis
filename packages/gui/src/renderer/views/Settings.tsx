import type { AppSettings, ConflictStrategy, SyncthisConfig } from '@syncthis/shared';
import { Cron } from 'croner';
import { NavArrowLeft } from 'iconoir-react';
import { useCallback, useEffect, useState } from 'react';
import { Toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';
import './Settings.css';

type ScheduleMode = 'interval' | 'cron';
type IntervalUnit = 'seconds' | 'minutes' | 'hours';

interface FormState {
  branch: string;
  scheduleMode: ScheduleMode;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  cronExpression: string;
  onConflict: ConflictStrategy;
  notify: boolean;
  autostart: boolean;
  daemonLabel: string;
}

function toSeconds(value: number, unit: IntervalUnit): number {
  if (unit === 'hours') return value * 3600;
  if (unit === 'minutes') return value * 60;
  return value;
}

function secondsToDisplay(seconds: number): { value: number; unit: IntervalUnit } {
  if (seconds >= 3600 && seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds >= 60 && seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

function configToForm(config: SyncthisConfig): FormState {
  const { value, unit } = secondsToDisplay(config.interval ?? 300);
  return {
    branch: config.branch,
    scheduleMode: config.interval !== null ? 'interval' : 'cron',
    intervalValue: value,
    intervalUnit: unit,
    cronExpression: config.cron ?? '*/5 * * * *',
    onConflict: config.onConflict === 'stop' ? 'auto-both' : config.onConflict,
    notify: config.notify ?? true,
    autostart: config.autostart ?? false,
    daemonLabel: config.daemonLabel ?? '',
  };
}

function formToConfig(form: FormState, original: SyncthisConfig): SyncthisConfig {
  return {
    remote: original.remote,
    branch: form.branch,
    interval:
      form.scheduleMode === 'interval' ? toSeconds(form.intervalValue, form.intervalUnit) : null,
    cron: form.scheduleMode === 'cron' ? form.cronExpression : null,
    onConflict: form.onConflict,
    notify: form.notify,
    autostart: form.autostart,
    daemonLabel: form.daemonLabel || undefined,
  };
}

function validateCron(expr: string): boolean {
  try {
    new Cron(expr, { paused: true });
    return true;
  } catch {
    return false;
  }
}

function intervalValid(value: number, unit: IntervalUnit): boolean {
  return Number.isInteger(value) && value > 0 && toSeconds(value, unit) >= 10;
}

function needsRestart(form: FormState, original: SyncthisConfig): boolean {
  const origForm = configToForm(original);
  return (
    form.scheduleMode !== origForm.scheduleMode ||
    toSeconds(form.intervalValue, form.intervalUnit) !==
      toSeconds(origForm.intervalValue, origForm.intervalUnit) ||
    form.cronExpression !== origForm.cronExpression ||
    form.onConflict !== origForm.onConflict ||
    form.autostart !== origForm.autostart
  );
}

function isDirty(form: FormState, original: SyncthisConfig): boolean {
  const origForm = configToForm(original);
  return (
    form.branch !== origForm.branch ||
    form.scheduleMode !== origForm.scheduleMode ||
    toSeconds(form.intervalValue, form.intervalUnit) !==
      toSeconds(origForm.intervalValue, origForm.intervalUnit) ||
    form.cronExpression !== origForm.cronExpression ||
    form.onConflict !== origForm.onConflict ||
    form.notify !== origForm.notify ||
    form.autostart !== origForm.autostart ||
    form.daemonLabel !== origForm.daemonLabel
  );
}

interface FolderSettingsFormProps {
  dirPath: string;
}

function FolderSettingsForm({ dirPath }: FolderSettingsFormProps) {
  const [config, setConfig] = useState<SyncthisConfig | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const { refreshFolders } = useAppContext();

  useEffect(() => {
    let cancelled = false;
    window.syncthis
      .invoke('config:read', { dirPath })
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setForm(configToForm(cfg));
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dirPath]);

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (!config || !form) {
    return <div className="settings-loading" />;
  }

  const cronValid = form.scheduleMode !== 'cron' || validateCron(form.cronExpression);
  const branchValid = form.branch.trim().length > 0;
  const ivValid =
    form.scheduleMode !== 'interval' || intervalValid(form.intervalValue, form.intervalUnit);
  const hasErrors = !cronValid || !branchValid || !ivValid;
  const dirty = isDirty(form, config);
  const canSave = dirty && !hasErrors && !saving;

  async function handleSave() {
    if (!config || !form) return;
    setSaving(true);
    try {
      const updated = formToConfig(form, config);
      await window.syncthis.invoke('config:write', { dirPath, config: updated });

      if (needsRestart(form, config)) {
        await window.syncthis.invoke('service:stop', { dirPath });
        await window.syncthis.invoke('service:start', { dirPath });
        setToast({ message: t('settings.saved_restarted'), variant: 'success' });
      } else {
        setToast({ message: t('settings.saved'), variant: 'success' });
      }

      setConfig(updated);
      setForm(configToForm(updated));
      await refreshFolders();
    } catch {
      setToast({ message: 'Failed to save settings.', variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!config) return;
    await navigator.clipboard.writeText(config.remote);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const conflictOptions: { value: ConflictStrategy; label: string }[] = [
    { value: 'auto-both', label: t('conflict_mode.auto_both') },
    { value: 'auto-newest', label: t('conflict_mode.auto_newest') },
    { value: 'ask', label: t('conflict_mode.ask') },
  ];

  const conflictDescKey = `settings.on_conflict_description.${form.onConflict.replace('-', '_')}` as
    | 'settings.on_conflict_description.auto_both'
    | 'settings.on_conflict_description.auto_newest'
    | 'settings.on_conflict_description.ask';

  return (
    <div className="settings-form">
      {/* Remote */}
      <div className="settings-field">
        <span className="settings-label">{t('settings.remote')}</span>
        <div className="settings-remote-row">
          <span className="settings-remote-value">{config.remote}</span>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? t('settings.remote_copied') : t('settings.remote_copy')}
          </Button>
        </div>
      </div>

      {/* Branch */}
      <div className="settings-field">
        <label className="settings-label" htmlFor={`branch-${dirPath}`}>
          {t('settings.branch')}
        </label>
        <input
          id={`branch-${dirPath}`}
          type="text"
          className={`settings-input${!branchValid ? ' settings-input--error' : ''}`}
          value={form.branch}
          onChange={(e) => update({ branch: e.target.value })}
        />
      </div>

      {/* Schedule */}
      <fieldset className="settings-field settings-fieldset">
        <legend className="settings-label">{t('settings.schedule')}</legend>
        <div className="settings-radio-group">
          <label className="settings-radio-option">
            <input
              type="radio"
              name={`schedule-${dirPath}`}
              checked={form.scheduleMode === 'interval'}
              onChange={() => update({ scheduleMode: 'interval' })}
            />
            <span>{t('settings.schedule_every')}</span>
            <input
              type="number"
              className={`settings-input settings-input--narrow${!ivValid ? ' settings-input--error' : ''}`}
              value={form.intervalValue}
              min={1}
              disabled={form.scheduleMode !== 'interval'}
              onChange={(e) => update({ intervalValue: Number(e.target.value) })}
            />
            <select
              className="settings-select"
              value={form.intervalUnit}
              disabled={form.scheduleMode !== 'interval'}
              onChange={(e) => update({ intervalUnit: e.target.value as IntervalUnit })}
            >
              <option value="seconds">{t('settings.schedule_seconds')}</option>
              <option value="minutes">{t('settings.schedule_minutes')}</option>
              <option value="hours">{t('settings.schedule_hours')}</option>
            </select>
          </label>
          {!ivValid && form.scheduleMode === 'interval' && (
            <span className="settings-error-text settings-error-text--indented">
              {t('settings.schedule_interval_invalid')}
            </span>
          )}
          <label className="settings-radio-option">
            <input
              type="radio"
              name={`schedule-${dirPath}`}
              checked={form.scheduleMode === 'cron'}
              onChange={() => update({ scheduleMode: 'cron' })}
            />
            <span>{t('settings.schedule_cron')}</span>
          </label>
          {form.scheduleMode === 'cron' && (
            <div className="settings-cron-input-row">
              <input
                type="text"
                className={`settings-input settings-input--mono${!cronValid ? ' settings-input--error' : ''}`}
                value={form.cronExpression}
                onChange={(e) => update({ cronExpression: e.target.value })}
                placeholder="*/5 * * * *"
              />
              {!cronValid && (
                <span className="settings-error-text">{t('settings.schedule_cron_invalid')}</span>
              )}
              {cronValid && (
                <span className="settings-hint-text">{t('settings.schedule_cron_hint')}</span>
              )}
            </div>
          )}
        </div>
      </fieldset>

      {/* On conflict */}
      <div className="settings-field">
        <label className="settings-label" htmlFor={`conflict-${dirPath}`}>
          {t('settings.on_conflict')}
        </label>
        <select
          id={`conflict-${dirPath}`}
          className="settings-select settings-select--full"
          value={form.onConflict}
          onChange={(e) => update({ onConflict: e.target.value as ConflictStrategy })}
        >
          {conflictOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="settings-description">{t(conflictDescKey)}</span>
      </div>

      {/* Notifications */}
      <div className="settings-field settings-field--row">
        <div>
          <span className="settings-label">{t('settings.notifications')}</span>
          <span className="settings-description">{t('settings.notifications_description')}</span>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={form.notify}
            onChange={(e) => update({ notify: e.target.checked })}
          />
          <span className="settings-switch-track" />
        </label>
      </div>

      {/* Autostart */}
      <div className="settings-field settings-field--row">
        <div>
          <span className="settings-label">{t('settings.autostart')}</span>
          <span className="settings-description">{t('settings.autostart_description')}</span>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={form.autostart}
            onChange={(e) => update({ autostart: e.target.checked })}
          />
          <span className="settings-switch-track" />
        </label>
      </div>

      {/* Service label */}
      <div className="settings-field">
        <label className="settings-label" htmlFor={`label-${dirPath}`}>
          {t('settings.label')}
        </label>
        <input
          id={`label-${dirPath}`}
          type="text"
          className="settings-input"
          value={form.daemonLabel}
          onChange={(e) => update({ daemonLabel: e.target.value })}
        />
        <span className="settings-hint-text">{t('settings.label_hint')}</span>
      </div>

      {/* Save */}
      <div className="settings-save-row">
        <Button disabled={!canSave} onClick={handleSave}>
          {t('settings.save')}
        </Button>
      </div>

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDone={() => setToast(null)} />
      )}
    </div>
  );
}

function AppSettingsForm() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState('');
  const [ivValue, setIvValue] = useState(5);
  const [ivUnit, setIvUnit] = useState<IntervalUnit>('minutes');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.syncthis.invoke('app:settings-read', undefined),
      window.syncthis.invoke('app:get-version', undefined),
    ]).then(([s, v]) => {
      if (cancelled) return;
      setSettings(s);
      const { value, unit } = secondsToDisplay(s.defaults.interval);
      setIvValue(value);
      setIvUnit(unit);
      setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (updated: AppSettings) => {
    setSettings(updated);
    await window.syncthis.invoke('app:settings-write', updated);
  }, []);

  if (!settings) return <div className="settings-loading" />;

  const ivValid = intervalValid(ivValue, ivUnit);

  async function handleIvBlur() {
    if (!settings) return;
    if (ivValid) {
      await save({
        ...settings,
        defaults: { ...settings.defaults, interval: toSeconds(ivValue, ivUnit) },
      });
    }
  }

  async function handleIvUnitChange(unit: IntervalUnit) {
    if (!settings) return;
    setIvUnit(unit);
    if (intervalValid(ivValue, unit)) {
      await save({
        ...settings,
        defaults: { ...settings.defaults, interval: toSeconds(ivValue, unit) },
      });
    }
  }

  return (
    <div className="settings-form">
      {/* General */}
      <p className="settings-section-title">{t('settings.general')}</p>
      <div className="settings-field settings-field--row">
        <div>
          <span className="settings-label">{t('settings.launch_on_login')}</span>
          <span className="settings-description">{t('settings.launch_on_login_description')}</span>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={settings.launchOnLogin}
            onChange={async (e) => {
              await save({ ...settings, launchOnLogin: e.target.checked });
            }}
          />
          <span className="settings-switch-track" />
        </label>
      </div>

      <Separator />

      {/* Defaults for new folders */}
      <p className="settings-section-title">{t('settings.defaults_title')}</p>
      <div className="settings-field">
        <span className="settings-label">{t('settings.defaults_schedule')}</span>
        <div className="settings-interval-row">
          <input
            type="number"
            className={`settings-input settings-input--narrow${!ivValid ? ' settings-input--error' : ''}`}
            value={ivValue}
            min={1}
            onChange={(e) => setIvValue(Number(e.target.value))}
            onBlur={handleIvBlur}
          />
          <select
            className="settings-select"
            value={ivUnit}
            onChange={(e) => handleIvUnitChange(e.target.value as IntervalUnit)}
          >
            <option value="seconds">{t('settings.schedule_seconds')}</option>
            <option value="minutes">{t('settings.schedule_minutes')}</option>
            <option value="hours">{t('settings.schedule_hours')}</option>
          </select>
        </div>
        {!ivValid && (
          <span className="settings-error-text">{t('settings.schedule_interval_invalid')}</span>
        )}
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor="defaults-conflict">
          {t('settings.defaults_on_conflict')}
        </label>
        <select
          id="defaults-conflict"
          className="settings-select settings-select--full"
          value={settings.defaults.onConflict}
          onChange={async (e) => {
            await save({
              ...settings,
              defaults: {
                ...settings.defaults,
                onConflict: e.target.value as AppSettings['defaults']['onConflict'],
              },
            });
          }}
        >
          <option value="auto-both">{t('conflict_mode.auto_both')}</option>
          <option value="auto-newest">{t('conflict_mode.auto_newest')}</option>
          <option value="ask">{t('conflict_mode.ask')}</option>
        </select>
      </div>

      <Separator />

      {/* GitHub */}
      <p className="settings-section-title">{t('settings.github_title')}</p>
      <div className="settings-field settings-field--row">
        <span className="settings-description">{t('settings.github_not_connected')}</span>
        <Button variant="secondary" size="sm" disabled title="Available in a future update.">
          {t('settings.github_connect')}
        </Button>
      </div>

      <Separator />

      {/* About */}
      <p className="settings-section-title">{t('settings.about_title')}</p>
      <p className="settings-description">{t('settings.version', { version })}</p>
    </div>
  );
}

export function Settings() {
  const { state, setView } = useAppContext();
  const [activeTab, setActiveTab] = useState<'folder' | 'app'>('folder');
  const folderName = state.activeFolderPath?.split('/').pop() ?? '';

  return (
    <div className="settings-view">
      <div className="settings-header">
        <Button variant="ghost" size="sm" onClick={() => setView('detail')}>
          <NavArrowLeft width={16} height={16} />
          &nbsp;
          {t('settings.back')}
        </Button>
        <h1 className="settings-title">{t('settings.title')}</h1>
      </div>

      <div className="settings-tabs">
        {state.activeFolderPath && (
          <button
            type="button"
            className={`settings-tab${activeTab === 'folder' ? ' settings-tab--active' : ''}`}
            onClick={() => setActiveTab('folder')}
          >
            {folderName}
          </button>
        )}
        <button
          type="button"
          className={`settings-tab${activeTab === 'app' ? ' settings-tab--active' : ''}`}
          onClick={() => setActiveTab('app')}
        >
          {t('settings.tab_app')}
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'folder' && state.activeFolderPath && (
          <FolderSettingsForm key={state.activeFolderPath} dirPath={state.activeFolderPath} />
        )}
        {activeTab === 'app' && <AppSettingsForm />}
      </div>
    </div>
  );
}
