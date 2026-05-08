import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/seed', label: 'Seed' },
  { to: '/clean', label: 'Clean' },
  { to: '/simulation', label: 'Simulation' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-5 dark:border-gray-800">
          <h1 className="text-lg font-bold text-teal-600 dark:text-teal-400">Seed Platform</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">Test Data Generator</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3 dark:border-gray-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-white p-8 dark:bg-gray-950">
        <Outlet />
      </main>
    </div>
  );
}
