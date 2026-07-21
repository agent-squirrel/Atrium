import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { portalsApi, vouchersApi } from '../../api'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import ConfirmModal from '../../components/ui/ConfirmModal'
import Badge from '../../components/ui/Badge'
import { ArrowLeftIcon, PlusIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { formatDate } from '../../lib/datetime'

export default function VouchersPage() {
  const { timezone: tz, dateFormat } = useDisplaySettings()
  const { id } = useParams<{ id: string }>()
  const portalId = parseInt(id!)
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [revokeVoucherId, setRevokeVoucherId] = useState<number | null>(null)
  const [form, setForm] = useState({
    count: 1, duration_minutes: 60, usage_limit: 1,
    note: '', expires_at: '',
    rate_limit_down: '', rate_limit_up: '',
  })

  const { data: portal } = useQuery({
    queryKey: ['portal', portalId],
    queryFn: () => portalsApi.get(portalId).then(r => r.data),
  })

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['vouchers', portalId],
    queryFn: () => vouchersApi.list(portalId).then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => vouchersApi.create(portalId, {
      count: form.count,
      duration_minutes: form.duration_minutes,
      usage_limit: form.usage_limit,
      note: form.note || null,
      expires_at: form.expires_at || null,
      rate_limit_down: form.rate_limit_down ? parseInt(form.rate_limit_down) : null,
      rate_limit_up: form.rate_limit_up ? parseInt(form.rate_limit_up) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vouchers', portalId] })
      toast.success(`${form.count} voucher(s) created`)
      setShowCreate(false)
    },
    onError: () => toast.error('Failed to create vouchers'),
  })

  const revokeMutation = useMutation({
    mutationFn: (voucherId: number) => vouchersApi.revoke(voucherId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vouchers', portalId] })
      toast.success('Voucher revoked')
      setRevokeVoucherId(null)
    },
    onError: () => {
      toast.error('Revoke failed')
      setRevokeVoucherId(null)
    },
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portals" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><ArrowLeftIcon className="w-5 h-5" /></Link>
        <PageHeader
          title={`Vouchers - ${portal?.name ?? '…'}`}
          subtitle={`${vouchers?.length ?? 0} vouchers`}
          action={
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
              <PlusIcon className="w-4 h-4" /> Generate Vouchers
            </button>
          }
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div> : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Code</th>
                <th className="px-6 py-3 text-left">Uses</th>
                <th className="px-6 py-3 text-left">Duration</th>
                <th className="px-6 py-3 text-left">Expires</th>
                <th className="px-6 py-3 text-left">Note</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vouchers?.map(v => (
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 font-mono font-bold text-gray-900 dark:text-gray-100 tracking-widest text-sm">{v.code}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{v.usage_count} / {v.usage_limit === 0 ? '∞' : v.usage_limit}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{v.duration_minutes} min</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {v.expires_at ? formatDate(v.expires_at, tz, dateFormat) : 'Never'}
                  </td>
                  <td className="px-6 py-3 text-gray-400 dark:text-gray-500 text-xs">{v.note || '-'}</td>
                  <td className="px-6 py-3">
                    <Badge
                      label={v.is_valid ? 'Valid' : !v.is_active ? 'Revoked' : 'Exhausted'}
                      variant={v.is_valid ? 'green' : 'red'}
                    />
                  </td>
                  <td className="px-6 py-3 text-right">
                    {v.is_active && (
                      <button
                        onClick={() => setRevokeVoucherId(v.id)}
                        title="Revoke"
                        className="text-gray-400 dark:text-gray-500 hover:text-red-500"
                      >
                        <XCircleIcon className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!vouchers?.length && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">No vouchers yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Generate Vouchers" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Count</label>
              <input type="number" min={1} max={500} value={form.count}
                onChange={e => setForm(f => ({ ...f, count: parseInt(e.target.value) || 1 }))}
                className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Duration (minutes)</label>
              <input type="number" min={1} value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) || 60 }))}
                className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Usage Limit (0 = unlimited)</label>
              <input type="number" min={0} value={form.usage_limit}
                onChange={e => setForm(f => ({ ...f, usage_limit: parseInt(e.target.value) || 1 }))}
                className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Download Limit (kbps, blank = unlimited)</label>
              <input type="number" min={0} value={form.rate_limit_down}
                onChange={e => setForm(f => ({ ...f, rate_limit_down: e.target.value }))}
                className={inp} placeholder="e.g. 5120" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Upload Limit (kbps)</label>
              <input type="number" min={0} value={form.rate_limit_up}
                onChange={e => setForm(f => ({ ...f, rate_limit_up: e.target.value }))}
                className={inp} placeholder="e.g. 2048" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Expires At (blank = never)</label>
            <input type="datetime-local" value={form.expires_at}
              onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
              className={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Note (optional)</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="e.g. Conference 2026" className={inp} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowCreate(false)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
              Generate {form.count > 1 ? `${form.count} Vouchers` : 'Voucher'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={revokeVoucherId !== null}
        onClose={() => setRevokeVoucherId(null)}
        onConfirm={() => revokeVoucherId !== null && revokeMutation.mutate(revokeVoucherId)}
        title="Revoke Voucher"
        message={
          <>Revoke voucher "{vouchers?.find(v => v.id === revokeVoucherId)?.code}"? This cannot be undone.</>
        }
        confirmLabel="Revoke"
        loading={revokeMutation.isPending}
      />
    </div>
  )
}

const inp = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'
