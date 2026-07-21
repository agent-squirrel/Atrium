import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  HomeIcon, BuildingOfficeIcon, UsersIcon, ServerIcon,
  GlobeAltIcon, ComputerDesktopIcon, ArrowRightOnRectangleIcon,
  Bars3Icon, XMarkIcon, Cog6ToothIcon, ClipboardDocumentListIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../store/auth'
import { useThemeStore } from '../../store/theme'
import AtriumLogo from './AtriumLogo'
import ThemeToggle from './ThemeToggle'
import clsx from 'clsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: HomeIcon, exact: true },
  { to: '/tenants', label: 'Tenants', icon: BuildingOfficeIcon, role: 'superadmin' },
  { to: '/controllers', label: 'Controllers', icon: ServerIcon, role: 'superadmin' },
  { to: '/sites', label: 'Sites', icon: GlobeAltIcon },
  { to: '/portals', label: 'Portals', icon: ComputerDesktopIcon },
  { to: '/users', label: 'Users', icon: UsersIcon, role: 'admin' },
  { to: '/audit-log', label: 'Audit Log', icon: ClipboardDocumentListIcon, role: 'admin' },
  { to: '/settings', label: 'Settings', icon: Cog6ToothIcon, role: 'superadmin' },
]

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const theme = useThemeStore((s) => s.theme)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    queryClient.clear()
    logout()
    navigate('/login')
  }

  const visibleNav = navItems.filter((item) => {
    if (!item.role) return true
    if (item.role === 'superadmin') return user?.role === 'superadmin'
    if (item.role === 'admin') return user?.role === 'superadmin' || user?.role === 'admin' || (user?.memberships?.some(m => m.role === 'admin') ?? false)
    return true
  })

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 flex flex-col transition-transform duration-200 ease-in-out',
        'md:relative md:z-auto md:translate-x-0 md:flex-shrink-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}>
        <div className="h-14 md:h-16 flex items-center justify-between px-5 border-b border-gray-700 flex-shrink-0">
          <AtriumLogo variant="white" className="h-10" />
          <button onClick={closeSidebar} className="text-gray-400 hover:text-white md:hidden">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              onClick={closeSidebar}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                )
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-700 flex-shrink-0">
          <div className="text-xs text-gray-500 mb-0.5 truncate">{user?.email}</div>
          <div className="text-xs text-gray-600 capitalize mb-3">{user?.role}</div>
          <div className="flex items-center justify-between">
            <NavLink to="/account" onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-1.5 text-sm transition-colors ${isActive ? 'text-white' : 'text-gray-400 hover:text-white'}`
              }
            >
              <UserCircleIcon className="w-4 h-4" />
              Account
            </NavLink>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4" />
              Sign out
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-700 flex items-center justify-between">
            <span className="text-xs text-gray-500">Appearance</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 px-4 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 p-1 -ml-1"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>
          <AtriumLogo variant={theme === 'dark' ? 'white' : 'navy'} className="h-10" />
          <div className="ml-auto">
            <ThemeToggle className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 py-5 md:px-6 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
