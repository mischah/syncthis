import type { ConflictFile, FileDiff, ImageData } from '@syncthis/shared';
import { NavArrowLeft } from 'iconoir-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffView } from '../components/DiffView';
import { Toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';
import './ConflictResolution.css';

interface ConflictState {
  files: ConflictFile[];
  activeFileIndex: number;
  diff: FileDiff | null;
  loading: boolean;
  mode: 'file' | 'hunk';
  activeHunkIndex: number;
  hunkDecisions: Array<'local' | 'remote'>;
  resolving: boolean;
  completing: boolean;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageCompare({ imageData }: { imageData: ImageData }) {
  const [localDims, setLocalDims] = useState<{ w: number; h: number } | null>(null);
  const [remoteDims, setRemoteDims] = useState<{ w: number; h: number } | null>(null);

  return (
    <div className="conflict-image-compare">
      <div className="conflict-image-side">
        <p className="conflict-image-label conflict-image-label--local">
          {t('conflict.image_local')}
        </p>
        <img
          className="conflict-image"
          src={imageData.localDataUrl}
          alt={t('conflict.image_local')}
          onLoad={(e) => {
            const img = e.currentTarget;
            setLocalDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        <p className="conflict-image-meta">
          {localDims ? t('conflict.image_dimensions', { w: localDims.w, h: localDims.h }) : ''}
          {localDims ? '  ·  ' : ''}
          {formatBytes(imageData.localSize)}
        </p>
      </div>
      <div className="conflict-image-side">
        <p className="conflict-image-label conflict-image-label--remote">
          {t('conflict.image_remote')}
        </p>
        <img
          className="conflict-image"
          src={imageData.remoteDataUrl}
          alt={t('conflict.image_remote')}
          onLoad={(e) => {
            const img = e.currentTarget;
            setRemoteDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        <p className="conflict-image-meta">
          {remoteDims ? t('conflict.image_dimensions', { w: remoteDims.w, h: remoteDims.h }) : ''}
          {remoteDims ? '  ·  ' : ''}
          {formatBytes(imageData.remoteSize)}
        </p>
      </div>
    </div>
  );
}

export function ConflictResolution() {
  const { state, setView, refreshFolders } = useAppContext();
  const dirPath = state.activeFolderPath ?? '';
  const folderName = state.folders.find((f) => f.dirPath === dirPath)?.name ?? '';

  const [cs, setCs] = useState<ConflictState>({
    files: [],
    activeFileIndex: 0,
    diff: null,
    loading: true,
    mode: 'file',
    activeHunkIndex: 0,
    hunkDecisions: [],
    resolving: false,
    completing: false,
  });
  const [toast, setToast] = useState<{ msg: string; variant: 'success' | 'error' } | null>(null);
  const [abortDialogOpen, setAbortDialogOpen] = useState(false);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedByUs = useRef(false);
  const prevConflictDetected = useRef<boolean | undefined>(undefined);

  const liveFolder = state.folders.find((f) => f.dirPath === dirPath);
  const conflictDetected = liveFolder?.conflictDetected;

  const loadFiles = useCallback(async () => {
    if (!dirPath) return;
    setCs((prev) => ({ ...prev, loading: true, error: null }));
    setError(null);
    try {
      const files = await window.syncthis.invoke('conflict:list-files', { dirPath });
      if (files.length === 0) {
        setCs((prev) => ({ ...prev, files: [], loading: false, diff: null }));
        return;
      }
      const diff = await window.syncthis.invoke('conflict:get-diff', {
        dirPath,
        filePath: files[0].filePath,
      });
      setCs((prev) => ({ ...prev, files, activeFileIndex: 0, diff, loading: false }));
    } catch {
      setCs((prev) => ({ ...prev, loading: false }));
      setError(t('conflict.diff_error'));
    }
  }, [dirPath]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Detect when conflict is resolved externally (e.g. via terminal)
  useEffect(() => {
    if (
      prevConflictDetected.current === true &&
      conflictDetected === false &&
      !resolvedByUs.current
    ) {
      setToast({ msg: t('conflict.resolved_externally'), variant: 'success' });
      const timer = setTimeout(() => {
        void refreshFolders();
        setView('detail');
      }, 2000);
      return () => clearTimeout(timer);
    }
    prevConflictDetected.current = conflictDetected;
  }, [conflictDetected, refreshFolders, setView]);

  async function selectFile(index: number) {
    const file = cs.files[index];
    if (!file) return;

    if (file.status === 'resolved') {
      setCs((prev) => ({
        ...prev,
        activeFileIndex: index,
        diff: null,
        mode: 'file',
        activeHunkIndex: 0,
        hunkDecisions: [],
      }));
      return;
    }

    setCs((prev) => ({
      ...prev,
      activeFileIndex: index,
      loading: true,
      diff: null,
      mode: 'file',
      activeHunkIndex: 0,
      hunkDecisions: [],
    }));
    try {
      const diff = await window.syncthis.invoke('conflict:get-diff', {
        dirPath,
        filePath: file.filePath,
      });
      setCs((prev) => ({ ...prev, diff, loading: false }));
    } catch {
      setCs((prev) => ({ ...prev, loading: false }));
      setError(t('conflict.diff_error'));
    }
  }

  async function advanceAfterFileResolved(newFiles: ConflictFile[]) {
    const nextPending = newFiles.findIndex((f) => f.status === 'pending');
    if (nextPending !== -1) {
      const diff = await window.syncthis.invoke('conflict:get-diff', {
        dirPath,
        filePath: newFiles[nextPending].filePath,
      });
      setCs((prev) => ({
        ...prev,
        files: newFiles,
        activeFileIndex: nextPending,
        diff,
        resolving: false,
        mode: 'file',
        activeHunkIndex: 0,
        hunkDecisions: [],
      }));
    } else {
      setCs((prev) => ({
        ...prev,
        files: newFiles,
        resolving: false,
        mode: 'file',
        hunkDecisions: [],
      }));
    }
  }

  async function resolveFile(choice: 'local' | 'remote' | 'both') {
    const file = cs.files[cs.activeFileIndex];
    if (!file) return;
    setActiveBtn(choice);
    setCs((prev) => ({ ...prev, resolving: true }));
    setError(null);
    try {
      await window.syncthis.invoke('conflict:resolve-file', {
        dirPath,
        filePath: file.filePath,
        choice,
      });
      const newFiles = cs.files.map((f, i) =>
        i === cs.activeFileIndex ? { ...f, status: 'resolved' as const } : f,
      );
      await advanceAfterFileResolved(newFiles);
    } catch (e) {
      setError(String(e));
      setCs((prev) => ({ ...prev, resolving: false }));
    } finally {
      setActiveBtn(null);
    }
  }

  async function resolveHunk(choice: 'local' | 'remote') {
    const file = cs.files[cs.activeFileIndex];
    if (!file || !cs.diff) return;
    setActiveBtn(`hunk-${choice}`);
    setError(null);

    const newDecisions = [...cs.hunkDecisions, choice];
    const totalHunks = cs.diff.hunks.length;

    if (newDecisions.length < totalHunks) {
      // More hunks to decide — advance without calling IPC
      setCs((prev) => ({
        ...prev,
        activeHunkIndex: prev.activeHunkIndex + 1,
        hunkDecisions: newDecisions,
      }));
      setActiveBtn(null);
      return;
    }

    // All hunks decided — send all decisions in one batch
    setCs((prev) => ({ ...prev, resolving: true }));
    try {
      await window.syncthis.invoke('conflict:resolve-hunks', {
        dirPath,
        filePath: file.filePath,
        decisions: newDecisions,
      });
      const newFiles = cs.files.map((f, i) =>
        i === cs.activeFileIndex ? { ...f, status: 'resolved' as const } : f,
      );
      await advanceAfterFileResolved(newFiles);
    } catch (e) {
      setError(String(e));
      setCs((prev) => ({ ...prev, resolving: false }));
    } finally {
      setActiveBtn(null);
    }
  }

  async function handleFinalize() {
    setCs((prev) => ({ ...prev, completing: true }));
    setError(null);
    try {
      await window.syncthis.invoke('conflict:finalize', { dirPath });
      resolvedByUs.current = true;
      await refreshFolders();
      setToast({ msg: t('conflict.resolved_toast'), variant: 'success' });
      setTimeout(() => setView('detail'), 500);
    } catch (e) {
      if (String(e).includes('push failed')) {
        // Rebase completed locally; push will retry on next cycle
        resolvedByUs.current = true;
        await refreshFolders();
        setToast({ msg: t('conflict.push_failed'), variant: 'error' });
        setTimeout(() => setView('detail'), 3000);
      } else {
        setError(t('conflict.rebase_failed'));
        setCs((prev) => ({ ...prev, completing: false }));
      }
    }
  }

  async function handleAbort() {
    setAbortDialogOpen(false);
    setError(null);
    try {
      await window.syncthis.invoke('conflict:abort', { dirPath });
      resolvedByUs.current = true;
      await refreshFolders();
      setView('detail');
    } catch {
      setError(t('conflict.abort_failed'));
    }
  }

  const allResolved = cs.files.length > 0 && cs.files.every((f) => f.status === 'resolved');
  const resolvedCount = cs.files.filter((f) => f.status === 'resolved').length;

  if (!cs.loading && cs.files.length === 0) {
    return (
      <div className="conflict-empty">
        <span className="conflict-empty-icon">⊘</span>
        <p className="conflict-empty-text">{t('conflict.no_conflicts')}</p>
        <Button variant="ghost" size="sm" onClick={() => setView('detail')}>
          {t('conflict.back', { name: folderName })}
        </Button>
      </div>
    );
  }

  return (
    <div className="conflict-view">
      <div className="conflict-header">
        <Button
          variant="ghost"
          size="sm"
          className="conflict-back-btn"
          onClick={() => setView('detail')}
        >
          <NavArrowLeft width={14} height={14} />
          &nbsp;{t('conflict.back', { name: folderName })}
        </Button>
        <div className="conflict-title-group">
          <h1 className="conflict-title">{t('conflict.title')}</h1>
          {cs.files.length > 0 && (
            <p className="conflict-subtitle">
              {t('conflict.files_resolved', { resolved: resolvedCount, total: cs.files.length })}
            </p>
          )}
        </div>
      </div>

      {cs.files.length > 0 && (
        <div className="conflict-files">
          <div className="conflict-file-list">
            {cs.files.map((file, i) => {
              const isActive = i === cs.activeFileIndex;
              const icon = file.status === 'resolved' ? '■' : isActive ? '●' : '○';
              const iconColor =
                file.status === 'resolved'
                  ? 'var(--status-healthy)'
                  : isActive
                    ? 'var(--accent)'
                    : 'var(--text-tertiary)';
              const label =
                file.status === 'resolved'
                  ? t('conflict.file_resolved')
                  : isActive
                    ? t('conflict.file_current')
                    : t('conflict.file_pending');
              return (
                <button
                  key={file.filePath}
                  type="button"
                  className={`conflict-file-row${isActive ? ' conflict-file-row--active' : ''}`}
                  onClick={() => selectFile(i)}
                >
                  <span className="conflict-file-icon" style={{ color: iconColor }}>
                    {icon}
                  </span>
                  <span className="conflict-file-name">{basename(file.filePath)}</span>
                  <span className="conflict-file-status" style={{ color: iconColor }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="conflict-progress-track">
            <div
              className="conflict-progress-fill"
              style={{
                width: `${cs.files.length > 0 ? (resolvedCount / cs.files.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="conflict-diff-area">
        {cs.loading && (
          <div className="conflict-loading">
            <span className="conflict-loading-text">…</span>
          </div>
        )}
        {!cs.loading && cs.diff?.imageData && !cs.diff.isBinary && (
          <ImageCompare imageData={cs.diff.imageData} />
        )}
        {!cs.loading && cs.diff && !cs.diff.isBinary && (
          <DiffView
            diff={cs.diff}
            mode={cs.mode === 'hunk' ? 'hunk' : 'unified'}
            activeHunkIndex={cs.mode === 'hunk' ? cs.activeHunkIndex : undefined}
          />
        )}
        {!cs.loading &&
          cs.diff?.isBinary &&
          (cs.diff.imageData ? (
            <ImageCompare imageData={cs.diff.imageData} />
          ) : (
            <div className="conflict-binary">
              <p className="conflict-binary-text">{t('conflict.binary_file')}</p>
            </div>
          ))}
      </div>

      <div className="conflict-actions">
        {cs.mode === 'hunk' && cs.diff && (
          <>
            <p className="conflict-hunk-progress">
              {t('conflict.hunk_progress', {
                current: cs.activeHunkIndex + 1,
                total: cs.diff.hunks.length,
              })}
            </p>
            <div className="conflict-action-buttons">
              <Button
                variant="secondary"
                size="sm"
                disabled={cs.resolving}
                onClick={() => resolveHunk('local')}
              >
                {activeBtn === 'hunk-local' && cs.resolving ? '…' : t('conflict.hunk_keep_local')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={cs.resolving}
                onClick={() => resolveHunk('remote')}
              >
                {activeBtn === 'hunk-remote' && cs.resolving ? '…' : t('conflict.hunk_keep_remote')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={cs.resolving}
                onClick={() =>
                  setCs((prev) => ({
                    ...prev,
                    mode: 'file',
                    activeHunkIndex: 0,
                    hunkDecisions: [],
                  }))
                }
              >
                {t('conflict.back_to_file')}
              </Button>
            </div>
          </>
        )}
        {cs.mode === 'file' && !allResolved && (
          <div className="conflict-action-buttons">
            <Button
              variant="secondary"
              size="sm"
              disabled={cs.resolving}
              onClick={() => resolveFile('local')}
            >
              {activeBtn === 'local' && cs.resolving ? '…' : t('conflict.keep_local')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={cs.resolving}
              onClick={() => resolveFile('remote')}
            >
              {activeBtn === 'remote' && cs.resolving ? '…' : t('conflict.keep_remote')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={cs.resolving}
              onClick={() => resolveFile('both')}
            >
              {activeBtn === 'both' && cs.resolving ? '…' : t('conflict.keep_both')}
            </Button>
            {!cs.diff?.isBinary && (cs.diff?.hunks.length ?? 0) > 1 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={cs.resolving}
                onClick={() =>
                  setCs((prev) => ({
                    ...prev,
                    mode: 'hunk',
                    activeHunkIndex: 0,
                    hunkDecisions: [],
                  }))
                }
              >
                {t('conflict.by_chunk')}
              </Button>
            )}
          </div>
        )}
        {allResolved && (
          <Button
            className="conflict-complete-btn"
            disabled={cs.completing}
            onClick={handleFinalize}
          >
            {cs.completing ? t('conflict.completing') : t('conflict.complete')}
          </Button>
        )}
        {error && <p className="conflict-error">{error}</p>}
      </div>

      <div className="conflict-footer">
        <Button
          variant="ghost"
          size="sm"
          className="conflict-abort-btn"
          onClick={() => setAbortDialogOpen(true)}
        >
          {t('conflict.abort')}
        </Button>
      </div>

      {toast && <Toast message={toast.msg} variant={toast.variant} onDone={() => setToast(null)} />}

      <Dialog open={abortDialogOpen} onOpenChange={setAbortDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conflict.abort_title')}</DialogTitle>
            <DialogDescription>{t('conflict.abort_body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setAbortDialogOpen(false)}
            >
              {t('action.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={handleAbort}
            >
              {t('conflict.abort_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
