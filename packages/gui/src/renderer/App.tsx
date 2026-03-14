import { useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { AppProvider, useAppContext } from './context/AppContext';
import { DetailView } from './views/DetailView';
import { Settings } from './views/Settings';
import './styles/index.css';

type ViewName = 'detail' | 'settings';

function ViewTransition({ view, folderPath }: { view: ViewName; folderPath: string | null }) {
  const [rendered, setRendered] = useState<ViewName>(view);
  const [animClass, setAnimClass] = useState('');
  const prevView = useRef(view);
  const prevFolder = useRef(folderPath);

  useEffect(() => {
    // View change: slide
    if (view !== prevView.current) {
      const direction = view === 'settings' ? 'slide-left' : 'slide-right';
      setAnimClass(`view-exit-${direction}`);
      const timer = setTimeout(() => {
        setRendered(view);
        setAnimClass(`view-enter-${direction}`);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setAnimClass(''));
        });
      }, 150);
      prevView.current = view;
      prevFolder.current = folderPath;
      return () => clearTimeout(timer);
    }
    // Folder change (same view): crossfade
    if (folderPath !== prevFolder.current) {
      setAnimClass('view-fade-out');
      const timer = setTimeout(() => {
        setAnimClass('view-fade-in');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setAnimClass(''));
        });
      }, 100);
      prevFolder.current = folderPath;
      return () => clearTimeout(timer);
    }
  }, [view, folderPath]);

  return (
    <div className={`view-transition ${animClass}`}>
      {rendered === 'detail' && <DetailView />}
      {rendered === 'settings' && <Settings />}
    </div>
  );
}

function AppLayout() {
  const { state, setView, setActiveFolder } = useAppContext();
  const showSidebar = state.folders.length >= 2;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Escape: go back from settings → detail (no mod needed)
      if (e.key === 'Escape') {
        if (stateRef.current.view === 'settings') {
          e.preventDefault();
          setView('detail');
        }
        return;
      }

      if (!mod) return;

      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        window.syncthis.invoke('app:hide-dashboard', undefined);
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        window.syncthis.invoke('app:quit', undefined);
      } else if (e.key === ',') {
        e.preventDefault();
        setView('settings');
      } else if (e.key === 'r' || e.key === 'R') {
        const { activeFolderPath, folders } = stateRef.current;
        if (activeFolderPath) {
          const folder = folders.find((f) => f.dirPath === activeFolderPath);
          if (folder?.health.serviceRunning) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('syncthis:sync-now'));
          }
        }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        window.syncthis.invoke('app:open-dashboard', undefined);
      } else {
        const num = Number.parseInt(e.key, 10);
        if (num >= 1 && num <= 9 && stateRef.current.folders.length >= 2) {
          const folder = stateRef.current.folders[num - 1];
          if (folder) {
            e.preventDefault();
            setActiveFolder(folder.dirPath);
            setView('detail');
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setView, setActiveFolder]);

  const viewName: ViewName =
    state.view === 'detail' || state.view === 'settings' ? state.view : 'detail';

  return (
    <div className="app-layout">
      <div
        style={{
          width: showSidebar ? 220 : 0,
          overflow: 'hidden',
          flexShrink: 0,
          transition: 'width 200ms ease',
        }}
      >
        <Sidebar />
      </div>
      <main className="app-content">
        <ViewTransition view={viewName} folderPath={state.activeFolderPath} />
      </main>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
