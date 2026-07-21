import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '../api'
import PageHeader from '../components/ui/PageHeader'
import { useDisplaySettings } from '../hooks/useDisplaySettings'
import { formatDateTime } from '../lib/datetime'
import type { AuditLog } from '../types'

const ACTION_LABELS: Record<string, string> = {
  'auth.login_success': 'Login',
  'auth.login_failure': 'Failed login',
  'auth.2fa_enabled': '2FA enabled',
  'auth.2fa_disabled': '2FA disabled',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset_completed': 'Password reset completed',
  'auth.password_reset_email_failed': 'Password reset email failed',
  'settings.update': 'Settings updated',
  'settings.email_update': 'Email settings updated',
  'settings.backup_downloaded': 'Backup downloaded',
  'setup.restored': 'Restored from backup',
  'portal.create': 'Portal created',
  'portal.update': 'Portal updated',
  'portal.delete': 'Portal deleted',
  'user.create': 'User created',
  'user.update': 'User updated',
  'user.delete': 'User deleted',
  'guest.manual_authorize': 'Manually authorized',
}

const ACTION_COLORS: Record<string, string> = {
  'auth.login_failure': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
  'auth.2fa_disabled': 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  'auth.password_reset_email_failed': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
  'portal.delete': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
  'user.delete': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
}

function ActionBadge({ action }: { action: string }) {
  const label = ACTION_LABELS[action] ?? action
  const color = ACTION_COLORS[action] ?? 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

function RelativeTime({ iso, tz, dateFormat }: { iso: string; tz: string; dateFormat: string }) {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)

  let rel: string
  if (mins < 1) rel = 'just now'
  else if (mins < 60) rel = `${mins}m ago`
  else if (hrs < 24) rel = `${hrs}h ago`
  else rel = `${days}d ago`

  return (
    <span title={formatDateTime(iso, tz, dateFormat)} className="cursor-default text-gray-500 dark:text-gray-400 text-xs">
      {rel}
    </span>
  )
}

function DetailCell({ detail }: { detail: AuditLog['detail'] }) {
  const [open, setOpen] = useState(false)
  if (!detail || Object.keys(detail).length === 0) return <span className="text-gray-300">-</span>
  const preview = Object.entries(detail).slice(0, 2).map(([k, v]) =>
    `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : String(v)}`
  ).join(' · ')
  return (
    <span>
      <button onClick={() => setOpen(o => !o)} className="text-xs text-blue-600 hover:underline">
        {open ? 'Hide' : 'Show'}
      </button>
      {open && (
        <pre className="mt-1 text-xs bg-gray-50 dark:bg-gray-900/40 rounded p-2 text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-w-xs">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
      {!open && <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{preview}</span>}
    </span>
  )
}

export default function AuditLogPage() {
  const { timezone: tz, dateFormat } = useDisplaySettings()
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page, actionFilter],
    queryFn: () => auditApi.list({ page, per_page: 50, action: actionFilter || undefined }).then(r => r.data),
    staleTime: 0,
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" subtitle="Record of all significant admin actions on this platform" />

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Filter by action…"
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(1) }}
          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
        />
        {actionFilter && (
          <button onClick={() => { setActionFilter(''); setPage(1) }}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
            Clear
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Resource</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                  <th className="px-4 py-3 text-left">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.items.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RelativeTime iso={log.created_at} tz={tz} dateFormat={dateFormat} />
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                      {log.user_email ?? <span className="text-gray-300">system</span>}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {log.resource_type ? (
                        <span>
                          <span className="text-gray-400 dark:text-gray-500 capitalize">{log.resource_type}</span>
                          {' '}
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {log.detail?.email
                              ? String(log.detail.email)
                              : log.detail?.name
                                ? String(log.detail.name)
                                : log.resource_id
                                  ? `#${log.resource_id}`
                                  : null}
                          </span>
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <DetailCell detail={log.detail} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 font-mono">
                      {log.ip_address ?? '-'}
                    </td>
                  </tr>
                ))}
                {!data?.items.length && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{data.total} total entries</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
              className="px-3 py-1 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">Previous</button>
            <span className="px-3 py-1">Page {page} of {data.pages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= data.pages}
              className="px-3 py-1 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
