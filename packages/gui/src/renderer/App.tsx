import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { AppProvider, useAppContext } from './context/AppContext';
import { DetailView } from './views/DetailView';
import './styles/index.css';

function AppLayout() {
  const { state } = useAppContext();
  const showSidebar = state.folders.length >= 2;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        window.syncthis.invoke('app:hide-dashboard', undefined);
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        window.syncthis.invoke('app:quit', undefined);
      } else if (e.key === ',') {
        e.preventDefault();
        // TODO: navigate to settings (Phase 7)
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-layout">
      {showSidebar && <Sidebar />}
      <main className="app-content">{state.view === 'detail' && <DetailView />}</main>
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
