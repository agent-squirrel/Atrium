import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { sitesApi, tenantsApi } from '../../api'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import SearchInput from '../../components/ui/SearchInput'
import { useAuthStore } from '../../store/auth'

export default function SitesPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [search, setSearch] = useState('')

  const { data: sites, isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list().then(r => r.data),
  })

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list().then(r => r.data),
    enabled: user?.role === 'superadmin',
  })

  const q = search.trim().toLowerCase()
  const filteredSites = sites?.filter(site =>
    !q
    || site.name.toLowerCase().includes(q)
    || site.unifi_site_id.toLowerCase().includes(q)
    || (site.controller_name ?? '').toLowerCase().includes(q)
    || (site.tenant_name ?? '').toLowerCase().includes(q)
  )

  const assignMutation = useMutation({
    mutationFn: ({ id, tenant_id }: { id: number; tenant_id: number | null }) =>
      sitesApi.update(id, { tenant_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      toast.success('Tenant assigned')
    },
    onError: () => toast.error('Assignment failed'),
  })

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Unifi sites synced from your controllers. Assign them to tenants and create portals."
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search sites…" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Site Name</th>
                <th className="px-6 py-3 text-left">Controller</th>
                <th className="px-6 py-3 text-left">Tenant</th>
                <th className="px-6 py-3 text-left">Portals</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSites?.map(site => (
                <tr key={site.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{site.name}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{site.unifi_site_id}</div>
                  </td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{site.controller_name}</td>
                  <td className="px-6 py-3">
                    {user?.role === 'superadmin' ? (
                      <select
                        value={site.tenant_id ?? ''}
                        onChange={e => assignMutation.mutate({ id: site.id, tenant_id: e.target.value ? parseInt(e.target.value) : null })}
                        className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">Unassigned</option>
                        {tenants?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">{site.tenant_name ?? '-'}</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      to={`/portals?site=${site.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      {site.portal_count} portal{site.portal_count !== 1 ? 's' : ''}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <Badge label={site.is_active ? 'Active' : 'Inactive'} variant={site.is_active ? 'green' : 'gray'} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link to={`/portals`} className="text-xs text-blue-600 hover:underline">
                      Portals →
                    </Link>
                  </td>
                </tr>
              ))}
              {!filteredSites?.length && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                  {sites?.length ? 'No sites match your search.' : 'No sites yet. Add a controller and run Sync.'}
                </td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
