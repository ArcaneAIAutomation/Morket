import { NavLink, useParams } from 'react-router-dom';
import { useUIStore } from '@/stores/ui.store';

const NAV_ITEMS = [
  { to: 'spreadsheet', label: 'Spreadsheet', icon: '📊' },
  { to: 'jobs', label: 'Jobs', icon: '⚡' },
  { to: 'search', label: 'Search', icon: '🔍' },
  { to: 'analytics', label: 'Analytics', icon: '📈' },
  { to: 'settings/workspace', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <aside
      className={`bg-gray-900 text-gray-300 flex flex-col transition-all duration-200 ${
        isSidebarCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div className="flex items-center justify-between h-14 px-3 border-b border-gray-700">
        {!isSidebarCollapsed && (
          <span className="text-white font-semibold text-lg">Morket</span>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={`/workspaces/${workspaceId}/${item.to}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white'
                  : 'hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span className="text-base">{item.icon}</span>
            {!isSidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
