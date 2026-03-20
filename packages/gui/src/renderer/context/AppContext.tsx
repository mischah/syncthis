import type { FolderSummary, UpdateInfo } from '@syncthis/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type { UpdateInfo };

interface AppState {
  folders: FolderSummary[];
  activeFolderPath: string | null;
  view: 'detail' | 'conflict' | 'setup' | 'settings';
  updateAvailable: UpdateInfo | null;
}

interface AppContextValue {
  state: AppState;
  setActiveFolder: (dirPath: string) => void;
  setView: (view: AppState['view']) => void;
  refreshFolders: () => Promise<void>;
  dismissUpdate: (version: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    folders: [],
    activeFolderPath: null,
    view: 'detail',
    updateAvailable: null,
  });

  const refreshFolders = useCallback(async () => {
    const folders = await window.syncthis.invoke('folders:list', undefined);
    setState((prev) => ({
      ...prev,
      folders,
      activeFolderPath:
        prev.activeFolderPath && folders.some((f) => f.dirPath === prev.activeFolderPath)
          ? prev.activeFolderPath
          : (folders[0]?.dirPath ?? null),
      // When the last folder is removed, return to the setup wizard
      view: folders.length === 0 ? 'setup' : prev.view,
    }));
  }, []);

  const dismissUpdate = useCallback(async (version: string) => {
    await window.syncthis.invoke('app:dismiss-update', { version });
    setState((prev) => ({ ...prev, updateAvailable: null }));
  }, []);

  useEffect(() => {
    // Initial load: navigate to setup wizard if no folders registered yet
    void (async () => {
      const folders = await window.syncthis.invoke('folders:list', undefined);
      setState((prev) => ({
        ...prev,
        folders,
        activeFolderPath:
          prev.activeFolderPath && folders.some((f) => f.dirPath === prev.activeFolderPath)
            ? prev.activeFolderPath
            : (folders[0]?.dirPath ?? null),
        view: folders.length === 0 ? 'setup' : prev.view,
      }));
    })();

    // Check for update on mount
    void (async () => {
      const info = await window.syncthis.invoke('app:check-update', undefined);
      if (info) {
        setState((prev) => ({ ...prev, updateAvailable: info }));
      }
    })();

    const interval = setInterval(() => {
      void refreshFolders();
    }, 10000);

    const unsubHealth = window.syncthis.on('health:changed', (data) => {
      setState((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => (f.dirPath === data.dirPath ? { ...f, health: data } : f)),
      }));
    });

    const unsubService = window.syncthis.on('service:state-changed', () => {
      refreshFolders();
    });

    const unsubNavigate = window.syncthis.on('app:navigate', ({ view, activeFolderPath }) => {
      setState((prev) => ({
        ...prev,
        view: view as AppState['view'],
        ...(activeFolderPath ? { activeFolderPath } : {}),
      }));
    });

    const unsubConflict = window.syncthis.on('conflict:detected', () => {
      refreshFolders();
    });

    const unsubUpdate = window.syncthis.on('update:available', (info) => {
      setState((prev) => ({ ...prev, updateAvailable: info }));
    });

    return () => {
      clearInterval(interval);
      unsubHealth();
      unsubService();
      unsubNavigate();
      unsubConflict();
      unsubUpdate();
    };
  }, [refreshFolders]);

  const setActiveFolder = useCallback((dirPath: string) => {
    setState((prev) => ({ ...prev, activeFolderPath: dirPath }));
  }, []);

  const setView = useCallback((view: AppState['view']) => {
    setState((prev) => ({ ...prev, view }));
  }, []);

  return (
    <AppContext.Provider value={{ state, setActiveFolder, setView, refreshFolders, dismissUpdate }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
