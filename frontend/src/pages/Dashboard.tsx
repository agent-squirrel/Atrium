import { useQuery } from '@tanstack/react-query'
import { portalsApi, dashboardApi } from '../api'
import { useAuthStore } from '../store/auth'
import PageHeader from '../components/ui/PageHeader'
import {
  ComputerDesktopIcon, GlobeAltIcon, ServerIcon,
  BuildingOfficeIcon, UsersIcon,
} from '@heroicons/react/24/outline'

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const isSuperadmin = user?.role === 'superadmin'

  const { data: portals } = useQuery({
    queryKey: ['portals'],
    queryFn: () => portalsApi.list().then(r => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['dashboard_stats'],
    queryFn: () => dashboardApi.stats().then(r => r.data),
    refetchInterval: 60_000,
  })

  const val = (n: number | undefined) => n ?? '-'

  return (
    <div>
      <PageHeader
        title={`Welcome back to Atrium, ${user?.first_name || user?.email}`}
        subtitle="Here's an overview of your portals."
      />

      <div className={`grid grid-cols-2 ${isSuperadmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4 mb-10`}>
        <StatCard label="Active Portals"   value={val(stats?.portals_active)} icon={ComputerDesktopIcon} color="bg-blue-500" />
        <StatCard label="Total Portals"    value={val(stats?.portals_total)}  icon={GlobeAltIcon}        color="bg-indigo-500" />
        <StatCard label="Active Guests"    value={val(stats?.active_guests)}  icon={UsersIcon}           color="bg-emerald-500" />
        {isSuperadmin && (
          <>
            <StatCard label="Controllers" value={val(stats?.controllers)} icon={ServerIcon}        color="bg-violet-500" />
            <StatCard label="Tenants"     value={val(stats?.tenants)}     icon={BuildingOfficeIcon} color="bg-amber-500" />
          </>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent Portals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-left">Site</th>
                <th className="px-6 py-3 text-left">Auth</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(portals ?? []).slice(0, 10).map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{p.site_name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 capitalize">{p.auth_type.replace('_', ' ')}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <a
                      href={p.portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-blue-600 px-2 py-0.5 rounded font-mono transition-colors"
                    >
                      {p.portal_url}
                    </a>
                  </td>
                </tr>
              ))}
              {!portals?.length && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                    No portals yet. Create one under Sites → Portals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
