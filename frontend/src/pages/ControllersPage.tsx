import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { controllersApi, tenantsApi } from '../api'
import type { UnifiController } from '../types'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import SearchInput from '../components/ui/SearchInput'
import { useDisplaySettings } from '../hooks/useDisplaySettings'
import { formatDateTime } from '../lib/datetime'
import {
  PlusIcon, ArrowPathIcon, CheckCircleIcon, PencilSquareIcon,
  ExclamationCircleIcon, WrenchScrewdriverIcon, CloudIcon, ServerIcon,
} from '@heroicons/react/24/outline'

const SYNC_OPTIONS = [
  { value: '',    label: 'Disabled' },
  { value: '1',   label: 'Every hour' },
  { value: '2',   label: 'Every 2 hours' },
  { value: '6',   label: 'Every 6 hours' },
  { value: '12',  label: 'Every 12 hours' },
  { value: '24',  label: 'Every 24 hours' },
  { value: '48',  label: 'Every 2 days' },
  { value: '168', label: 'Every 7 days' },
]

function formatSyncInterval(hours: number): string {
  if (hours < 24) return `${hours}h`
  if (hours === 48) return '2 days'
  if (hours === 168) return '7 days'
  return `${hours}h`
}

const emptyForm = {
  name: '', controller_type: 'self_hosted' as 'self_hosted' | 'cloud',
  url: '', auth_mode: 'password', username: '', password: '', api_key: '',
  verify_ssl: true, owner_type: 'platform', tenant_id: '', sync_interval_hours: '',
}

// ── Type selector ──────────────────────────────────────────────────────────────

function TypeToggle({
  value, onChange,
}: { value: 'self_hosted' | 'cloud'; onChange: (v: 'self_hosted' | 'cloud') => void }) {
  return (
    <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden text-sm">
      {([['self_hosted', ServerIcon, 'Self-hosted'], ['cloud', CloudIcon, 'UniFi Site Manager']] as const).map(
        ([type, Icon, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 font-medium transition-colors ${
              value === type ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        )
      )}
    </div>
  )
}

// ── Credential fields (self-hosted only) ──────────────────────────────────────

function SelfHostedFields({
  f, set, isEdit = false,
}: {
  f: typeof emptyForm
  set: (fn: (prev: typeof emptyForm) => typeof emptyForm) => void
  isEdit?: boolean
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Controller URL</label>
        <input
          value={f.url}
          onChange={e => set(p => ({ ...p, url: e.target.value }))}
          className={inp}
          placeholder="https://unifi.example.com"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Authentication</label>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden text-sm">
          {(['password', 'api_key'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => set(p => ({ ...p, auth_mode: mode }))}
              className={`flex-1 py-2 font-medium transition-colors ${
                f.auth_mode === mode ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              {mode === 'password' ? 'Username / Password' : 'API Key (2FA-safe)'}
            </button>
          ))}
        </div>
      </div>
      {f.auth_mode === 'api_key' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
          <input
            type="password"
            value={f.api_key}
            onChange={e => set(p => ({ ...p, api_key: e.target.value }))}
            className={inp}
            placeholder={isEdit ? 'Leave blank to keep current' : 'Paste API key…'}
            required={!isEdit}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Generate in UniFi OS → Integrations. Bypasses 2FA.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input
              value={f.username}
              onChange={e => set(p => ({ ...p, username: e.target.value }))}
              className={inp}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={f.password}
              onChange={e => set(p => ({ ...p, password: e.target.value }))}
              className={inp}
              placeholder={isEdit ? 'Leave blank to keep current' : undefined}
              required={!isEdit}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={isEdit ? 'edit-ssl' : 'ssl'}
          checked={f.verify_ssl}
          onChange={e => set(p => ({ ...p, verify_ssl: e.target.checked }))}
          className="w-4 h-4 accent-blue-600"
        />
        <label htmlFor={isEdit ? 'edit-ssl' : 'ssl'} className="text-sm text-gray-700 dark:text-gray-300">
          Verify SSL certificate
        </label>
      </div>
    </>
  )
}

// ── Cloud credential field ────────────────────────────────────────────────────

function CloudFields({
  f, set, isEdit = false,
}: {
  f: typeof emptyForm
  set: (fn: (prev: typeof emptyForm) => typeof emptyForm) => void
  isEdit?: boolean
}) {
  return (
    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-4 space-y-3">
      <div className="flex items-start gap-2 text-sm text-blue-800 dark:text-blue-300">
        <CloudIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Connects to <strong>unifi.ui.com</strong> using the Site Manager API.
          Generate an API key at{' '}
          <a
            href="https://unifi.ui.com/settings/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-900"
          >
            unifi.ui.com → Settings → API Keys
          </a>.
        </span>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
        <input
          type="password"
          value={f.api_key}
          onChange={e => set(p => ({ ...p, api_key: e.target.value }))}
          className={inp}
          placeholder={isEdit ? 'Leave blank to keep current' : 'Paste API key…'}
          required={!isEdit}
        />
      </div>
    </div>
  )
}

// ── Shared bottom fields ──────────────────────────────────────────────────────

function CommonFields({
  f, set, tenants,
}: {
  f: typeof emptyForm
  set: (fn: (prev: typeof emptyForm) => typeof emptyForm) => void
  tenants: { id: number; name: string }[] | undefined
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Owner Type</label>
        <select
          value={f.owner_type}
          onChange={e => set(p => ({ ...p, owner_type: e.target.value }))}
          className={inp}
        >
          <option value="platform">Platform (MSP-owned)</option>
          <option value="tenant">Tenant-owned</option>
        </select>
      </div>
      {f.owner_type === 'tenant' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tenant</label>
            <select
              value={f.tenant_id}
              onChange={e => set(p => ({ ...p, tenant_id: e.target.value }))}
              className={inp}
              required
            >
              <option value="">Select tenant…</option>
              {tenants?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
            Assigning a controller to a tenant grants all users in that tenant visibility of every site on this controller.
          </p>
        </>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Automatic sync</label>
        <select
          value={f.sync_interval_hours}
          onChange={e => set(p => ({ ...p, sync_interval_hours: e.target.value }))}
          className={inp}
        >
          {SYNC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Minimum 1 hour · maximum 7 days · disabled means manual sync only
        </p>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ControllersPage() {
  const qc = useQueryClient()
  const { timezone: tz, dateFormat } = useDisplaySettings()
  const [showCreate, setShowCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<UnifiController | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState(emptyForm)

  const [search, setSearch] = useState('')

  const { data: controllers, isLoading } = useQuery({
    queryKey: ['controllers'],
    queryFn: () => controllersApi.list().then(r => r.data),
  })

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list().then(r => r.data),
  })

  const q = search.trim().toLowerCase()
  const filteredControllers = controllers?.filter(c => {
    if (!q) return true
    const tenantName = tenants?.find(t => t.id === c.tenant_id)?.name ?? ''
    return c.name.toLowerCase().includes(q)
      || (c.url ?? '').toLowerCase().includes(q)
      || tenantName.toLowerCase().includes(q)
  })

  const createMutation = useMutation({
    mutationFn: () => controllersApi.create({
      ...form,
      tenant_id: form.tenant_id ? parseInt(form.tenant_id) : null,
      sync_interval_hours: form.sync_interval_hours ? parseInt(form.sync_interval_hours) : null,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['controllers'] })
      qc.invalidateQueries({ queryKey: ['sites'] })
      const sync = res.data.sync
      toast.success(
        sync
          ? `Controller added and synced - ${sync.synced} site(s), ${sync.aps_synced} AP(s)`
          : 'Controller added'
      )
      setShowCreate(false)
      setCreateError(null)
      setForm(emptyForm)
    },
    onError: (err: any) => {
      setCreateError(err.response?.data?.error || 'Connection failed - check your credentials.')
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      const isCloud = editForm.controller_type === 'cloud'
      const payload: Record<string, unknown> = {
        name: editForm.name,
        owner_type: editForm.owner_type,
        tenant_id: editForm.tenant_id ? parseInt(editForm.tenant_id) : null,
        sync_interval_hours: editForm.sync_interval_hours ? parseInt(editForm.sync_interval_hours) : null,
      }
      if (editForm.api_key) payload.api_key = editForm.api_key
      if (!isCloud) {
        payload.url = editForm.url
        payload.auth_mode = editForm.auth_mode
        payload.verify_ssl = editForm.verify_ssl
        if (editForm.auth_mode === 'password') {
          payload.username = editForm.username
          if (editForm.password) payload.password = editForm.password
        }
      }
      return controllersApi.update(editing!.id, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['controllers'] })
      toast.success('Controller updated')
      setEditing(null)
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Update failed'),
  })

  function openEdit(c: UnifiController) {
    setEditForm({
      name: c.name,
      controller_type: c.controller_type ?? 'self_hosted',
      url: c.url ?? '',
      auth_mode: c.auth_mode ?? 'password',
      username: c.username ?? '',
      password: '',
      api_key: '',
      verify_ssl: c.verify_ssl,
      owner_type: c.owner_type,
      tenant_id: c.tenant_id ? String(c.tenant_id) : '',
      sync_interval_hours: c.sync_interval_hours ? String(c.sync_interval_hours) : '',
    })
    setEditing(c)
  }

  const [syncingId, setSyncingId] = useState<number | null>(null)
  const syncMutation = useMutation({
    mutationFn: (id: number) => controllersApi.sync(id),
    onMutate: (id) => setSyncingId(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      qc.invalidateQueries({ queryKey: ['controllers'] })
      toast.success(`Synced ${res.data.synced} site(s)`)
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Sync failed'),
    onSettled: () => setSyncingId(null),
  })

  const testMutation = useMutation({
    mutationFn: (id: number) => controllersApi.test(id),
    onSuccess: (res) => {
      if (res.data.ok) toast.success('Connection OK')
      else toast.error(res.data.message)
    },
  })

  const maintenanceMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      controllersApi.update(id, { maintenance_mode: enabled }),
    onSuccess: (_, { enabled }) => {
      qc.invalidateQueries({ queryKey: ['controllers'] })
      toast.success(enabled ? 'Maintenance mode on' : 'Maintenance mode off')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Update failed'),
  })

  return (
    <div>
      <PageHeader
        title="Controllers"
        subtitle="UniFi Network Application connections."
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            <PlusIcon className="w-4 h-4" /> Add Controller
          </button>
        }
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search controllers…" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-6 py-3 text-left">Type / URL</th>
                  <th className="px-6 py-3 text-left">Auth</th>
                  <th className="px-6 py-3 text-left">Owner</th>
                  <th className="px-6 py-3 text-left">Last Sync</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredControllers?.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-2">
                        {c.name}
                        {c.maintenance_mode && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-full px-2 py-0.5">
                            <WrenchScrewdriverIcon className="w-3 h-3" /> Maintenance
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      {c.controller_type === 'cloud' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-full px-2.5 py-0.5">
                          <CloudIcon className="w-3 h-3" /> UniFi Site Manager
                        </span>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{c.url}</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge
                        label={c.auth_mode === 'api_key' ? 'API Key' : 'Password'}
                        variant={c.auth_mode === 'api_key' ? 'green' : 'gray'}
                      />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Badge label={c.owner_type} variant={c.owner_type === 'platform' ? 'blue' : 'yellow'} />
                        {c.owner_type === 'tenant' && c.tenant_id && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {tenants?.find(t => t.id === c.tenant_id)?.name ?? `Tenant #${c.tenant_id}`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-xs">
                      <div className="text-gray-400 dark:text-gray-500">
                        {c.last_synced_at ? formatDateTime(c.last_synced_at, tz, dateFormat) : 'Never'}
                      </div>
                      <div className={c.sync_interval_hours ? 'text-blue-500' : 'text-gray-300'}>
                        {c.sync_interval_hours
                          ? `Auto every ${formatSyncInterval(c.sync_interval_hours)}`
                          : 'Manual only'}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right flex items-center justify-end gap-2">
                      <button
                        onClick={() => maintenanceMutation.mutate({ id: c.id, enabled: !c.maintenance_mode })}
                        title={c.maintenance_mode ? 'Disable maintenance mode' : 'Enable maintenance mode'}
                        className={c.maintenance_mode ? 'text-amber-500 hover:text-amber-700' : 'text-gray-400 dark:text-gray-500 hover:text-amber-500'}
                      >
                        <WrenchScrewdriverIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => testMutation.mutate(c.id)} title="Test connection"
                        className="text-gray-400 dark:text-gray-500 hover:text-green-600">
                        <CheckCircleIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => syncMutation.mutate(c.id)}
                        title="Sync sites"
                        className={`text-gray-400 dark:text-gray-500 hover:text-blue-600 ${syncingId === c.id ? 'animate-spin' : ''}`}
                      >
                        <ArrowPathIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => openEdit(c)} title="Edit controller"
                        className="text-gray-400 dark:text-gray-500 hover:text-blue-600">
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredControllers?.length && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                      {controllers?.length ? 'No controllers match your search.' : 'No controllers yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateError(null) }}
        title="Add Controller"
        size="lg"
      >
        <form
          onSubmit={e => { e.preventDefault(); setCreateError(null); createMutation.mutate() }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inp}
              placeholder="Main Controller"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Controller Type</label>
            <TypeToggle
              value={form.controller_type}
              onChange={v => setForm(f => ({ ...f, controller_type: v, auth_mode: 'password' }))}
            />
          </div>

          {form.controller_type === 'cloud' ? (
            <CloudFields f={form} set={setForm} />
          ) : (
            <SelfHostedFields f={form} set={setForm} />
          )}

          <CommonFields f={form} set={setForm} tenants={tenants} />

          {createError && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <ExclamationCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{createError}</span>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setCreateError(null) }}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {createMutation.isPending ? 'Connecting & syncing…' : 'Add Controller'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Controller" size="lg">
        <form onSubmit={e => { e.preventDefault(); updateMutation.mutate() }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
            <input
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              className={inp}
              required
            />
          </div>

          {/* Type is immutable - show as read-only info */}
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
            {editForm.controller_type === 'cloud'
              ? <><CloudIcon className="w-4 h-4 text-blue-500" /> UniFi Site Manager (cloud)</>
              : <><ServerIcon className="w-4 h-4" /> Self-hosted</>
            }
          </div>

          {editForm.controller_type === 'cloud' ? (
            <CloudFields f={editForm} set={setEditForm} isEdit />
          ) : (
            <SelfHostedFields f={editForm} set={setEditForm} isEdit />
          )}

          <CommonFields f={editForm} set={setEditForm} tenants={tenants} />

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditing(null)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const inp = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'
