import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { usersApi, tenantsApi } from '../api'
import { useAuthStore } from '../store/auth'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import SearchInput from '../components/ui/SearchInput'
import { PlusIcon, PencilSquareIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { User, UserRole, UserTenantMembership } from '../types'

const inp = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'
const sel = inp

function checkPassword(pw: string): string | null {
  if (pw.length < 8) return 'Too short - must be at least 8 characters'
  if (!/\d/.test(pw)) return 'Must include at least one number (0–9)'
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Must include at least one special character (e.g. ! @ # $)'
  return null
}

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'superadmin', label: 'Superadmin', description: 'Full platform access - manages all tenants, controllers, and settings' },
  { value: 'admin',      label: 'Admin',      description: 'Manages portals, sites, and users within their assigned tenant' },
  { value: 'client',     label: 'Client',     description: 'Read-only access to view portal analytics and guest data' },
]

const TENANT_ROLES = [
  { value: 'admin',  label: 'Admin'  },
  { value: 'client', label: 'Client' },
]

const roleVariant = (role: UserRole) =>
  ({ superadmin: 'red', admin: 'yellow', client: 'blue' } as const)[role] ?? 'gray'

// ── Edit Modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  user: User
  onClose: () => void
  actorIsSuperadmin: boolean
  tenants: { id: number; name: string }[]
}

function EditModal({ user, onClose, actorIsSuperadmin, tenants }: EditModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email,
    password: '',
    confirmPassword: '',
    role: user.role,
    tenant_id: user.tenant_id?.toString() || '',
    is_active: user.is_active,
  })
  const [pwError, setPwError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Memberships local state (start from user.memberships, mutate in place)
  const [memberships, setMemberships] = useState<UserTenantMembership[]>(user.memberships ?? [])
  const [addTenantId, setAddTenantId] = useState('')
  const [addRole, setAddRole] = useState<'admin' | 'client'>('client')

  const updateMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        email: form.email,
        is_active: form.is_active,
      }
      if (actorIsSuperadmin) {
        payload.role = form.role
        payload.tenant_id = form.role === 'superadmin' ? null : (form.tenant_id ? parseInt(form.tenant_id) : null)
      }
      if (form.password) payload.password = form.password
      return usersApi.update(user.id, payload as any)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User saved')
      onClose()
    },
    onError: (err: any) => setFormError(err.response?.data?.error || 'Save failed'),
  })

  const addMembershipMutation = useMutation({
    mutationFn: ({ tenantId, role }: { tenantId: number; role: string }) =>
      usersApi.addMembership(user.id, tenantId, role),
    onSuccess: (res) => {
      setMemberships(prev => {
        const next = prev.filter(m => m.tenant_id !== res.data.tenant_id)
        return [...next, res.data]
      })
      qc.invalidateQueries({ queryKey: ['users'] })
      setAddTenantId('')
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to add access'),
  })

  const removeMembershipMutation = useMutation({
    mutationFn: (membershipId: number) => usersApi.removeMembership(user.id, membershipId),
    onSuccess: (_, membershipId) => {
      setMemberships(prev => prev.filter(m => m.id !== membershipId))
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: () => toast.error('Failed to remove access'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password) {
      if (form.password !== form.confirmPassword) { setPwError('Passwords do not match'); return }
      const err = checkPassword(form.password)
      if (err) { setPwError(err); return }
    }
    setPwError(null)
    setFormError(null)
    updateMutation.mutate()
  }

  // Tenants not yet assigned (exclude primary tenant and existing memberships)
  const usedTenantIds = new Set([
    ...(form.tenant_id ? [parseInt(form.tenant_id)] : []),
    ...memberships.map(m => m.tenant_id),
  ])
  const availableTenants = tenants.filter(t => !usedTenantIds.has(t.id))

  return (
    <Modal open onClose={onClose} title={`Edit - ${user.full_name}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic info */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Basic Info</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
              <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className={inp} placeholder="Jane" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
              <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className={inp} placeholder="Smith" />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className={inp} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              New Password <span className="text-gray-400 dark:text-gray-500 font-normal">(leave blank to keep current)</span>
            </label>
            <input type="password" value={form.password}
              onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setPwError(null) }}
              className={inp} autoComplete="new-password" />
          </div>
          {form.password && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
              <input type="password" value={form.confirmPassword}
                onChange={e => { setForm(f => ({ ...f, confirmPassword: e.target.value })); setPwError(null) }}
                className={inp} autoComplete="new-password" />
              {pwError && <p className="text-red-500 text-xs mt-1">{pwError}</p>}
            </div>
          )}
        </div>

        {/* Account */}
        <div className="border-t pt-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Account</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {actorIsSuperadmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select value={form.role}
                  onChange={e => {
                    const role = e.target.value as UserRole
                    setForm(f => ({ ...f, role, tenant_id: role === 'superadmin' ? '' : f.tenant_id }))
                  }}
                  className={sel}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {ROLES.find(r => r.value === form.role)?.description}
                </p>
              </div>
            )}
            {actorIsSuperadmin && form.role !== 'superadmin' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Primary Tenant</label>
                <select value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                  className={sel}>
                  <option value="">None</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Account active</span>
          </label>
        </div>

        {/* Tenant memberships - superadmin only */}
        {actorIsSuperadmin && (
          <div className="border-t pt-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Additional Tenant Access</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Grant this user access to additional tenants with a specific role, independent of their primary tenant.
            </p>

            {memberships.length > 0 && (
              <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Tenant</th>
                      <th className="px-4 py-2 text-left">Role</th>
                      <th className="px-4 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {memberships.map(m => (
                      <tr key={m.id}>
                        <td className="px-4 py-2 font-medium text-gray-800">{m.tenant_name}</td>
                        <td className="px-4 py-2">
                          <Badge
                            label={m.role === 'admin' ? 'Admin' : 'Client'}
                            variant={m.role === 'admin' ? 'yellow' : 'blue'}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button type="button"
                            onClick={() => removeMembershipMutation.mutate(m.id)}
                            disabled={removeMembershipMutation.isPending}
                            className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {availableTenants.length > 0 && (
              <div className="flex items-center gap-2">
                <select value={addTenantId} onChange={e => setAddTenantId(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select tenant…</option>
                  {availableTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select value={addRole} onChange={e => setAddRole(e.target.value as 'admin' | 'client')}
                  className="w-28 flex-shrink-0 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {TENANT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button type="button"
                  disabled={!addTenantId || addMembershipMutation.isPending}
                  onClick={() => addMembershipMutation.mutate({ tenantId: parseInt(addTenantId), role: addRole })}
                  className="flex items-center gap-1 flex-shrink-0 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-700 dark:text-gray-300 text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 whitespace-nowrap transition-colors">
                  <PlusIcon className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            )}

            {availableTenants.length === 0 && memberships.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No additional tenants available.</p>
            )}
            {availableTenants.length === 0 && memberships.length > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">All tenants assigned.</p>
            )}
          </div>
        )}

        {formError && <p className="text-red-500 text-sm">{formError}</p>}

        <div className="flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
          <button type="submit" disabled={updateMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const qc = useQueryClient()
  const actor = useAuthStore(s => s.user)
  const actorIsSuperadmin = actor?.role === 'superadmin'

  // Tenants this actor can create users in (admin-level access only)
  const actorAdminTenants: { id: number; name: string }[] = (() => {
    if (actorIsSuperadmin) return []  // superadmin uses the full tenants query below
    const map = new Map<number, string>()
    if (actor?.role === 'admin' && actor.tenant_id && actor.tenant_name) {
      map.set(actor.tenant_id, actor.tenant_name)
    }
    actor?.memberships?.filter(m => m.role === 'admin').forEach(m => {
      if (m.tenant_name) map.set(m.tenant_id, m.tenant_name)
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  })()

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(() => ({
    email: '', password: '', confirmPassword: '', first_name: '', last_name: '',
    role: 'client' as UserRole,
    // Pre-fill tenant for single-tenant admins
    tenant_id: !actorIsSuperadmin && actorAdminTenants.length === 1
      ? String(actorAdminTenants[0].id) : '',
  }))
  const [createPwError, setCreatePwError] = useState<string | null>(null)

  // Edit modal
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // Delete confirmation
  const [deletingUser, setDeletingUser] = useState<User | null>(null)

  const [search, setSearch] = useState('')

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  })

  const q = search.trim().toLowerCase()
  const filteredUsers = users?.filter(u =>
    !q
    || u.full_name.toLowerCase().includes(q)
    || u.email.toLowerCase().includes(q)
    || u.role.toLowerCase().includes(q)
    || (u.tenant_name ?? '').toLowerCase().includes(q)
  )

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list().then(r => r.data),
    enabled: actorIsSuperadmin,
  })

  const createMutation = useMutation({
    mutationFn: () => usersApi.create({
      email: createForm.email,
      password: createForm.password,
      first_name: createForm.first_name || undefined,
      last_name: createForm.last_name || undefined,
      role: createForm.role,
      tenant_id: createForm.tenant_id ? parseInt(createForm.tenant_id) : undefined,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      setShowCreate(false)
      setCreatePwError(null)
      setCreateForm({
        email: '', password: '', confirmPassword: '', first_name: '', last_name: '', role: 'client',
        tenant_id: !actorIsSuperadmin && actorAdminTenants.length === 1
          ? String(actorAdminTenants[0].id) : '',
      })
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create user'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted')
      setDeletingUser(null)
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Delete failed'),
  })

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage admin and client user accounts."
        action={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            <PlusIcon className="w-4 h-4" /> Add User
          </button>
        }
      />

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-6 py-3 text-left">Email</th>
                  <th className="px-6 py-3 text-left">Role</th>
                  <th className="px-6 py-3 text-left">Tenant Access</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUsers?.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{u.full_name}</td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                    <td className="px-6 py-3">
                      <Badge label={u.role} variant={roleVariant(u.role)} />
                    </td>
                    <td className="px-6 py-3">
                      <TenantAccessSummary user={u} />
                    </td>
                    <td className="px-6 py-3">
                      <Badge label={u.is_active ? 'Active' : 'Inactive'} variant={u.is_active ? 'green' : 'gray'} />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="text-gray-400 dark:text-gray-500 hover:text-blue-600 transition-colors"
                          title="Edit user"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        {u.id !== actor?.id && (
                          <button
                            onClick={() => setDeletingUser(u)}
                            className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                            title="Delete user"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredUsers?.length && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                      {users?.length ? 'No users match your search.' : 'No users yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add User" size="lg">
        <form onSubmit={e => {
          e.preventDefault()
          if (createForm.password !== createForm.confirmPassword) {
            setCreatePwError('Passwords do not match'); return
          }
          const err = checkPassword(createForm.password)
          setCreatePwError(err)
          if (err) return
          createMutation.mutate()
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
              <input value={createForm.first_name}
                onChange={e => setCreateForm(f => ({ ...f, first_name: e.target.value }))}
                className={inp} placeholder="Jane" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
              <input value={createForm.last_name}
                onChange={e => setCreateForm(f => ({ ...f, last_name: e.target.value }))}
                className={inp} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={createForm.email}
              onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
              className={inp} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" value={createForm.password}
              onChange={e => { setCreateForm(f => ({ ...f, password: e.target.value })); setCreatePwError(null) }}
              className={inp} required />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">At least 8 characters, including a number and special character (e.g. ! @ # $)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
            <input type="password" value={createForm.confirmPassword}
              onChange={e => { setCreateForm(f => ({ ...f, confirmPassword: e.target.value })); setCreatePwError(null) }}
              className={inp} required />
            {createPwError && <p className="text-red-500 text-xs mt-1">{createPwError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
              <select
                value={createForm.role}
                onChange={e => {
                  const role = e.target.value as UserRole
                  setCreateForm(f => ({ ...f, role, tenant_id: role === 'superadmin' ? '' : f.tenant_id }))
                }}
                className={sel}>
                {ROLES.filter(r => actorIsSuperadmin ? true : r.value !== 'superadmin').map(r =>
                  <option key={r.value} value={r.value}>{r.label}</option>
                )}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {ROLES.find(r => r.value === createForm.role)?.description}
              </p>
            </div>
            {/* Superadmin: pick any tenant */}
            {actorIsSuperadmin && createForm.role !== 'superadmin' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tenant</label>
                <select value={createForm.tenant_id}
                  onChange={e => setCreateForm(f => ({ ...f, tenant_id: e.target.value }))}
                  className={sel}>
                  <option value="">None</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {/* Multi-tenant admin: pick from their admin tenants */}
            {!actorIsSuperadmin && actorAdminTenants.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tenant</label>
                <select value={createForm.tenant_id}
                  onChange={e => setCreateForm(f => ({ ...f, tenant_id: e.target.value }))}
                  className={sel} required>
                  <option value="">Select tenant…</option>
                  {actorAdminTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {/* Single-tenant admin: show which tenant, read-only */}
            {!actorIsSuperadmin && actorAdminTenants.length === 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tenant</label>
                <div className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                  {actorAdminTenants[0].name}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCreate(false)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
              Create User
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editingUser && (
        <EditModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          actorIsSuperadmin={actorIsSuperadmin}
          tenants={tenants}
        />
      )}

      {/* Delete confirmation modal */}
      <Modal open={!!deletingUser} onClose={() => setDeletingUser(null)} title="Delete User" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Are you sure you want to delete <span className="font-medium text-gray-900 dark:text-gray-100">{deletingUser?.email}</span>?
            This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeletingUser(null)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-4 py-2">
              Cancel
            </button>
            <button
              onClick={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
              {deleteMutation.isPending ? 'Deleting…' : 'Delete User'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function TenantAccessSummary({ user }: { user: User }) {
  const extras = user.memberships ?? []
  if (extras.length === 0 && !user.tenant_id) return <span className="text-gray-400 dark:text-gray-500 text-xs">-</span>
  if (extras.length === 0) return <span className="text-xs text-gray-500 dark:text-gray-400">Primary only</span>

  return (
    <div className="flex flex-wrap gap-1">
      {extras.slice(0, 2).map(m => (
        <span key={m.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded px-1.5 py-0.5">
          {m.tenant_name} · <span className={m.role === 'admin' ? 'text-amber-600' : 'text-blue-600'}>{m.role}</span>
        </span>
      ))}
      {extras.length > 2 && (
        <span className="text-xs text-gray-400 dark:text-gray-500">+{extras.length - 2} more</span>
      )}
    </div>
  )
}
