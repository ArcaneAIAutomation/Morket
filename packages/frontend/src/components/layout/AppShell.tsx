import { Outlet } from 'react-router-dom';
import { useUIStore } from '@/stores/ui.store';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default function AppShell() {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Desktop sidebar — always visible at md+ */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {isSidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 md:hidden">
            <Sidebar />
          </div>
        </>
      )}

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
