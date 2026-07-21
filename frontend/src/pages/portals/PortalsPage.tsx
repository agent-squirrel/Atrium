import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { portalsApi, sitesApi } from '../../api'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import ConfirmModal from '../../components/ui/ConfirmModal'
import Badge from '../../components/ui/Badge'
import SearchInput from '../../components/ui/SearchInput'
import { PlusIcon, PencilSquareIcon, TrashIcon, UsersIcon, ChartBarIcon, TicketIcon, InformationCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import type { AuthType } from '../../types'
import { useAuthStore } from '../../store/auth'

const authTypeLabels: Record<AuthType, string> = {
  click_through: 'Click-through',
  voucher: 'Voucher',
  both: 'Both',
}

export default function PortalsPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canCreate = user?.role === 'superadmin' || user?.role === 'admin'
    || (user?.memberships ?? []).some(m => m.role === 'admin')
  const [showCreate, setShowCreate] = useState(false)
  const [deletePortalId, setDeletePortalId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', site_id: '', auth_type: 'click_through' as AuthType, ssids: [] as string[] })
  const [search, setSearch] = useState('')

  const { data: portals, isLoading } = useQuery({
    queryKey: ['portals'],
    queryFn: () => portalsApi.list().then(r => r.data),
  })

  const q = search.trim().toLowerCase()
  const filteredPortals = portals?.filter(p =>
    !q
    || p.name.toLowerCase().includes(q)
    || (p.site_name ?? '').toLowerCase().includes(q)
    || p.ssids.some(s => s.toLowerCase().includes(q))
  )

  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list().then(r => r.data),
  })

  const siteId = form.site_id ? parseInt(form.site_id) : null
  const { data: ssidsData } = useQuery({
    queryKey: ['site_ssids', siteId],
    queryFn: () => sitesApi.ssids(siteId!).then(r => r.data),
    enabled: !!siteId,
  })

  const createMutation = useMutation({
    mutationFn: () => portalsApi.create({
      name: form.name,
      site_id: parseInt(form.site_id),
      auth_type: form.auth_type,
      ssids: form.ssids,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portals'] })
      toast.success('Portal created')
      setShowCreate(false)
      setForm({ name: '', site_id: '', auth_type: 'click_through', ssids: [] })
    },
    onError: () => toast.error('Failed to create portal'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => portalsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portals'] })
      toast.success('Portal deleted')
      setDeletePortalId(null)
    },
    onError: () => {
      toast.error('Delete failed')
      setDeletePortalId(null)
    },
  })

  return (
    <div>
      <PageHeader
        title="Portals"
        subtitle="Captive portal instances. Each portal can target a site or a specific SSID."
        action={canCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <PlusIcon className="w-4 h-4" /> New Portal
          </button>
        ) : undefined}
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search portals…" />
      </div>

      <div className="mb-4 flex items-start gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
        <InformationCircleIcon className="w-5 h-5 mt-0.5 shrink-0 text-blue-500" />
        <div>
          <span className="font-medium">Unifi configuration: </span>
          go to <span className="font-medium">Network → Settings → Guest Control → External Portal Server</span> and enter this server's IP address.
          UniFi automatically appends <code className="bg-blue-100 px-1 rounded font-mono">/guest/s/&lt;site-id&gt;/</code> to the IP -
          the correct portal is resolved from the site and SSID automatically.
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Portal</th>
                <th className="px-6 py-3 text-left">Site / SSID</th>
                <th className="px-6 py-3 text-left">Auth</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Preview URL</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPortals?.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">
                    <div>{p.site_name}</div>
                    {p.ssids.length > 0 && <div className="text-xs text-gray-400 dark:text-gray-500">{p.ssids.join(', ')}</div>}
                  </td>
                  <td className="px-6 py-3">
                    <Badge label={authTypeLabels[p.auth_type]} variant="blue" />
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge label={p.is_active ? 'Active' : 'Inactive'} variant={p.is_active ? 'green' : 'gray'} />
                      {p.maintenance_mode && <Badge label="Maintenance" variant="yellow" />}
                    </div>
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
                  <td className="px-6 py-3 text-right flex items-center justify-end gap-2">
                    <Link to={`/portals/${p.id}/guests`} title="Guests">
                      <UsersIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-blue-600" />
                    </Link>
                    <Link to={`/portals/${p.id}/analytics`} title="Analytics">
                      <ChartBarIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-blue-600" />
                    </Link>
                    {p.auth_type !== 'click_through' && (
                      <Link to={`/portals/${p.id}/vouchers`} title="Vouchers">
                        <TicketIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-blue-600" />
                      </Link>
                    )}
                    {canCreate && <>
                      <Link to={`/portals/${p.id}/edit`} title="Edit">
                        <PencilSquareIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-blue-600" />
                      </Link>
                      <button
                        onClick={() => setDeletePortalId(p.id)}
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-red-500" />
                      </button>
                    </>}
                  </td>
                </tr>
              ))}
              {!filteredPortals?.length && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                  {portals?.length ? 'No portals match your search.' : 'No portals yet. Click "New Portal" to get started.'}
                </td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Portal">
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate() }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portal Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Main Lobby WiFi"
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Site</label>
            <select
              value={form.site_id}
              onChange={e => setForm(f => ({ ...f, site_id: e.target.value, ssids: [] }))}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
              required
            >
              <option value="">Select a site…</option>
              {sites?.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.controller_name ? ` - ${s.controller_name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SSID</label>
            {ssidsData?.error && (
              <p className="flex items-center gap-1 text-xs text-amber-600 mb-1">
                <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                Could not fetch SSIDs from controller
              </p>
            )}
            {!siteId ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">Select a site first</p>
            ) : (
              <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.ssids.length === 0}
                    onChange={() => setForm(f => ({ ...f, ssids: [] }))}
                    className="w-4 h-4 accent-blue-600"
                  />
                  All SSIDs
                </label>
                {(ssidsData?.ssids ?? []).map(s => (
                  <label key={s} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.ssids.includes(s)}
                      onChange={e => setForm(f => ({
                        ...f,
                        ssids: e.target.checked ? [...f.ssids, s] : f.ssids.filter(x => x !== s),
                      }))}
                      className="w-4 h-4 accent-blue-600"
                    />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Auth Type</label>
            <select
              value={form.auth_type}
              onChange={e => setForm(f => ({ ...f, auth_type: e.target.value as AuthType }))}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
            >
              <option value="click_through">Click-through (no code needed)</option>
              <option value="voucher">Voucher only</option>
              <option value="both">Both (voucher optional)</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
              Create Portal
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={deletePortalId !== null}
        onClose={() => setDeletePortalId(null)}
        onConfirm={() => deletePortalId !== null && deleteMutation.mutate(deletePortalId)}
        title="Delete Portal"
        message={
          <>Delete "{portals?.find(p => p.id === deletePortalId)?.name}"? This cannot be undone.</>
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
