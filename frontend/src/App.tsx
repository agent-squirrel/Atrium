import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi, setupApi } from './api'
import { useAuthStore } from './store/auth'
import { useThemeStore } from './store/theme'
import AtriumLogo from './components/ui/AtriumLogo'
import LoginPage from './pages/Login'
import ForgotPasswordPage from './pages/ForgotPassword'
import ResetPasswordPage from './pages/ResetPassword'
import SetupPage from './pages/Setup'
import Layout from './components/ui/Layout'
import Dashboard from './pages/Dashboard'
import TenantsPage from './pages/tenants/TenantsPage'
import SitesPage from './pages/sites/SitesPage'
import PortalsPage from './pages/portals/PortalsPage'
import PortalEditorPage from './pages/portals/PortalEditorPage'
import GuestsPage from './pages/guests/GuestsPage'
import AnalyticsPage from './pages/guests/AnalyticsPage'
import VouchersPage from './pages/vouchers/VouchersPage'
import UsersPage from './pages/UsersPage'
import ControllersPage from './pages/ControllersPage'
import SettingsPage from './pages/SettingsPage'
import AccountPage from './pages/AccountPage'
import AuditLogPage from './pages/AuditLogPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const token = localStorage.getItem('access_token')
  if (!token && !user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const setUser = useAuthStore((s) => s.setUser)
  const token = localStorage.getItem('access_token')
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const { data: setupStatus, isLoading: setupLoading, failureCount } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const { data } = await setupApi.status()
      return data
    },
    // The web container starts independently of db/backend (see
    // docker-compose.yml) and this is the first request the SPA makes, so
    // failures here are usually just "the backend isn't up yet" rather than
    // a real error - keep retrying with a capped backoff instead of giving
    // up, and show a "starting up" screen for as long as this is pending.
    retry: true,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
    staleTime: Infinity,
  })

  // The backend writes its current startup stage to a static file nginx can
  // serve directly, so this can show real progress instead of a generic
  // "starting up" message - see backend/entrypoint.sh and nginx.conf's
  // /status/ location.
  const { data: startupMessage } = useQuery({
    queryKey: ['startup-message'],
    queryFn: async () => {
      const res = await fetch('/status/state.json', { cache: 'no-store' })
      if (!res.ok) return null
      const body = await res.json()
      return typeof body.message === 'string' ? body.message : null
    },
    enabled: setupLoading,
    retry: true,
    retryDelay: 1500,
    // A successful response just means "the file had this stage in it at
    // the time" - it can still change (db setup -> starting server), so
    // keep polling on a plain interval rather than only retrying failures.
    refetchInterval: 1500,
    staleTime: 0,
  })

  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await authApi.me()
      setUser(data)
      return data
    },
    enabled: !!token && !setupLoading && !setupStatus?.needs_setup,
    retry: false,
  })

  if (setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
        <div className="flex flex-col items-center gap-5">
          <AtriumLogo variant="white" className="h-14" />
          <div className="w-8 h-8 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
          {failureCount > 0 && (
            <p className="text-slate-400 text-sm">{startupMessage ?? 'Atrium is starting up…'}</p>
          )}
        </div>
      </div>
    )
  }

  const needsSetup = setupStatus?.needs_setup === true

  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route
          path="/setup"
          element={needsSetup ? <SetupPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/login"
          element={needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />}
        />
        <Route
          path="/forgot-password"
          element={needsSetup ? <Navigate to="/setup" replace /> : <ForgotPasswordPage />}
        />
        <Route
          path="/reset-password"
          element={needsSetup ? <Navigate to="/setup" replace /> : <ResetPasswordPage />}
        />
        <Route
          path="/"
          element={
            needsSetup ? (
              <Navigate to="/setup" replace />
            ) : (
              <RequireAuth>
                <Layout />
              </RequireAuth>
            )
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="controllers" element={<ControllersPage />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="portals" element={<PortalsPage />} />
          <Route path="portals/:id/edit" element={<PortalEditorPage />} />
          <Route path="portals/:id/guests" element={<GuestsPage />} />
          <Route path="portals/:id/analytics" element={<AnalyticsPage />} />
          <Route path="portals/:id/vouchers" element={<VouchersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
        <Route
          path="*"
          element={<Navigate to={needsSetup ? '/setup' : '/'} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}
