import { NavLink, Outlet, useParams } from 'react-router-dom';

const SETTINGS_TABS = [
  { to: 'workspace', label: 'Workspace' },
  { to: 'members', label: 'Members' },
  { to: 'credentials', label: 'Credentials' },
  { to: 'options', label: 'Options' },
  { to: 'billing', label: 'Billing' },
];

export default function SettingsLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <div className="flex flex-col h-full">
      <nav className="border-b border-gray-200 bg-white px-6" aria-label="Settings navigation">
        <ul className="flex gap-6 -mb-px">
          {SETTINGS_TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={`/workspaces/${workspaceId}/settings/${tab.to}`}
                className={({ isActive }) =>
                  `inline-block py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}
