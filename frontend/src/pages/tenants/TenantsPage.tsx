import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { tenantsApi } from '../../api'
import type { Tenant } from '../../types'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import ConfirmModal from '../../components/ui/ConfirmModal'
import Badge from '../../components/ui/Badge'
import SearchInput from '../../components/ui/SearchInput'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { formatDate } from '../../lib/datetime'
import { PlusIcon } from '@heroicons/react/24/outline'

export default function TenantsPage() {
  const { timezone: tz, dateFormat } = useDisplaySettings()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null)

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list().then(r => r.data),
  })

  const q = search.trim().toLowerCase()
  const filteredTenants = tenants?.filter(t =>
    !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
  )

  const createMutation = useMutation({
    mutationFn: () => tenantsApi.create({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      toast.success('Tenant created')
      setShowCreate(false)
      setName('')
    },
    onError: () => toast.error('Failed to create tenant'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      tenantsApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
    onError: () => toast.error('Update failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => tenantsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      toast.success('Tenant deleted')
      setDeletingTenant(null)
    },
    onError: () => toast.error('Failed to delete tenant'),
  })

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Manage client organisations on this platform."
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <PlusIcon className="w-4 h-4" /> Add Tenant
          </button>
        }
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tenants…" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-left">Slug</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Created</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTenants?.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{t.name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400"><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{t.slug}</code></td>
                  <td className="px-6 py-3">
                    <Badge label={t.is_active ? 'Active' : 'Inactive'} variant={t.is_active ? 'green' : 'gray'} />
                  </td>
                  <td className="px-6 py-3 text-gray-400 dark:text-gray-500 text-xs">{formatDate(t.created_at, tz, dateFormat)}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => toggleMutation.mutate({ id: t.id, is_active: !t.is_active })}
                      className="text-xs text-blue-600 hover:underline mr-4"
                    >
                      {t.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => setDeletingTenant(t)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredTenants?.length && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                  {tenants?.length ? 'No tenants match your search.' : 'No tenants yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Tenant">
        <form
          onSubmit={(e) => { e.preventDefault(); createMutation.mutate() }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Organisation Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Acme Pizza Group"
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              Create
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!deletingTenant}
        onClose={() => setDeletingTenant(null)}
        onConfirm={() => deletingTenant && deleteMutation.mutate(deletingTenant.id)}
        title="Delete Tenant"
        confirmLabel="Delete Tenant"
        loading={deleteMutation.isPending}
        message={
          <>
            Delete <span className="font-medium text-gray-900 dark:text-gray-100">{deletingTenant?.name}</span>?
            Its controllers, sites, and portals aren't deleted - they're reassigned to the platform (unscoped from
            any tenant) and keep working. Any users whose primary organisation is this tenant will lose that
            assignment and need to be reassigned manually. This can't be undone.
          </>
        }
      />
    </div>
  )
}
