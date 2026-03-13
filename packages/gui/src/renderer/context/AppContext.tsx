import type { FolderSummary } from '@syncthis/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface UpdateInfo {
  version: string;
}

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
    }));
  }, []);

  useEffect(() => {
    refreshFolders();

    const interval = setInterval(async () => {
      const healths = await window.syncthis.invoke('health:all', undefined);
      setState((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => {
          const h = healths.find((hh) => hh.dirPath === f.dirPath);
          return h ? { ...f, health: h } : f;
        }),
      }));
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

    return () => {
      clearInterval(interval);
      unsubHealth();
      unsubService();
    };
  }, [refreshFolders]);

  const setActiveFolder = useCallback((dirPath: string) => {
    setState((prev) => ({ ...prev, activeFolderPath: dirPath }));
  }, []);

  const setView = useCallback((view: AppState['view']) => {
    setState((prev) => ({ ...prev, view }));
  }, []);

  return (
    <AppContext.Provider value={{ state, setActiveFolder, setView, refreshFolders }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
