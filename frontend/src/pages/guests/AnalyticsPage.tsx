import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { portalsApi, guestsApi } from '../../api'
import type { GuestFilters } from '../../api'
import PageHeader from '../../components/ui/PageHeader'
import { ArrowLeftIcon, ArrowDownTrayIcon, FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useThemeStore } from '../../store/theme'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { formatDateTime } from '../../lib/datetime'

const input = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'

// Format hour label: 0 → "12am", 13 → "1pm"
function fmtHour(h: number) {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export default function AnalyticsPage() {
  const { timezone: tz, dateFormat } = useDisplaySettings()
  const theme = useThemeStore((s) => s.theme)
  const gridStroke = theme === 'dark' ? '#374151' : '#f0f0f0'
  const tickFill = theme === 'dark' ? '#9CA3AF' : '#6B7280'
  const { id } = useParams<{ id: string }>()
  const portalId = parseInt(id!)
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState<Omit<GuestFilters, 'page' | 'per_page' | 'search'>>({
    mac: searchParams.get('mac') ?? '',
    ssid: searchParams.get('ssid') ?? '',
    date_from: searchParams.get('date_from') ?? '',
    date_to: searchParams.get('date_to') ?? '',
  })
  const [page, setPage] = useState(1)
  const [applied, setApplied] = useState({ ...filters })

  useEffect(() => {
    const mac = searchParams.get('mac') ?? ''
    setFilters(f => ({ ...f, mac }))
    setApplied(f => ({ ...f, mac }))
  }, [searchParams.get('mac')])

  const { data: portal } = useQuery({
    queryKey: ['portal', portalId],
    queryFn: () => portalsApi.get(portalId).then(r => r.data),
  })

  const { data: ssidsData } = useQuery({
    queryKey: ['portal_ssids', portalId],
    queryFn: () => portalsApi.ssids(portalId).then(r => r.data),
    enabled: !!portal,
  })

  const { data: summary } = useQuery({
    queryKey: ['analytics_summary', portalId, applied],
    queryFn: () => guestsApi.summary(portalId, applied).then(r => r.data),
  })

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['guests', portalId, page, applied],
    queryFn: () => guestsApi.list(portalId, { ...applied, page, per_page: 50 }).then(r => r.data),
  })

  const fieldDefs = portal?.fields ?? []

  const apply = () => {
    setPage(1)
    setApplied({ ...filters })
    const params: Record<string, string> = {}
    if (filters.mac) params.mac = filters.mac
    if (filters.ssid) params.ssid = filters.ssid
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to) params.date_to = filters.date_to
    setSearchParams(params)
  }

  const clear = () => {
    const cleared = { mac: '', ssid: '', date_from: '', date_to: '' }
    setFilters(cleared)
    setApplied(cleared)
    setPage(1)
    setSearchParams({})
  }

  const hasFilters = Object.values(applied).some(Boolean)
  const handleExport = () => guestsApi.exportCsv(portalId, applied)

  // Peak hour label - only show every 3 hours to avoid crowding
  const hourTick = (h: number) => h % 3 === 0 ? fmtHour(h) : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/portals/${portalId}/guests`} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <PageHeader
          title={`Analytics - ${portal?.name ?? '…'}`}
          subtitle="Historical guest session data"
          action={
            <button
              onClick={handleExport}
              className="flex items-center gap-2 border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <ArrowDownTrayIcon className="w-4 h-4" /> Export CSV
            </button>
          }
        />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <FunnelIcon className="w-4 h-4" /> Filters
          {hasFilters && (
            <button onClick={clear} className="ml-auto flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-normal">
              <XMarkIcon className="w-3.5 h-3.5" /> Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Device MAC</label>
            <input value={filters.mac} onChange={e => setFilters(f => ({ ...f, mac: e.target.value }))}
              placeholder="aa:bb:cc:…" className={input} onKeyDown={e => e.key === 'Enter' && apply()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">SSID</label>
            <select value={filters.ssid} onChange={e => setFilters(f => ({ ...f, ssid: e.target.value }))} className={input}>
              <option value="">All SSIDs</option>
              {ssidsData?.ssids.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">From</label>
            <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} className={input} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">To</label>
            <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} className={input} />
          </div>
        </div>
        <button onClick={apply}
          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          Apply Filters
        </button>
      </div>

      {/* Stat cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Sessions"    value={summary.total_sessions.toLocaleString()} />
          <StatCard label="Unique Devices"    value={summary.unique_devices.toLocaleString()} />
          <StatCard label="Return Visitors"   value={`${summary.return_visitor_rate}%`}
            sub={`${Math.round(summary.unique_devices * summary.return_visitor_rate / 100)} device(s) seen more than once`} />
          <StatCard
            label="Auth Failures"
            value={summary.auth_failures.count.toLocaleString()}
            sub={`${summary.auth_failures.rate}% failure rate`}
            accent={summary.auth_failures.count > 0 ? 'red' : undefined}
          />
        </div>
      )}

      {/* Sessions over time */}
      {summary && summary.sessions_by_day.length > 0 && (
        <ChartCard title="Sessions Over Time">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.sessions_by_day} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} />
              <Bar dataKey="count" fill="#3B82F6" radius={[3, 3, 0, 0]} name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Peak hours + day-of-week side by side */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Peak Hours" subtitle="Sessions by hour of day">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={summary.sessions_by_hour} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="hour" tickFormatter={hourTick} tick={{ fontSize: 10, fill: tickFill }} tickLine={false} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} formatter={(v) => [v, 'Sessions']} labelFormatter={(h) => fmtHour(Number(h))} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Sessions">
                  {summary.sessions_by_hour.map((entry) => (
                    <Cell key={entry.hour} fill={entry.count === Math.max(...summary.sessions_by_hour.map(h => h.count)) ? '#1D4ED8' : '#93C5FD'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Day of Week" subtitle="Sessions by day">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={summary.sessions_by_dow} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} formatter={(v) => [v, 'Sessions']} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Sessions">
                  {summary.sessions_by_dow.map((entry) => (
                    <Cell key={entry.day} fill={entry.count === Math.max(...summary.sessions_by_dow.map(d => d.count)) ? '#7C3AED' : '#C4B5FD'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Top APs + Auth failures side by side */}
      {summary && (summary.top_aps.length > 0 || summary.auth_failures.count > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.top_aps.length > 0 && (
            <ChartCard title="Top Access Points" subtitle="Sessions per AP">
              <ResponsiveContainer width="100%" height={Math.min(40 + summary.top_aps.length * 32, 300)}>
                <BarChart data={summary.top_aps} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} width={130} />
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} formatter={(v, _, props) => [v, props.payload.ap_mac]} />
                  <Bar dataKey="count" fill="#10B981" radius={[0, 3, 3, 0]} name="Sessions" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {summary.auth_failures.count > 0 && (
            <ChartCard title="Auth Failures" subtitle={`${summary.auth_failures.count} failed (${summary.auth_failures.rate}% of sessions)`}>
              {summary.auth_failures.top_errors.length > 0 ? (
                <div className="space-y-2 mt-1">
                  {summary.auth_failures.top_errors.map(({ error, count }) => (
                    <div key={error} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[260px]" title={error}>{error}</span>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 ml-2 flex-shrink-0">{count}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-400 rounded-full"
                            style={{ width: `${Math.round(count / summary.auth_failures.count * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">No error details recorded.</p>
              )}
            </ChartCard>
          )}
        </div>
      )}

      {/* Field value charts */}
      {summary && Object.keys(summary.field_counts).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fieldDefs.map(field => {
            const fc = summary.field_counts[field.field_key]
            if (!fc || fc.values.length === 0) return null
            const chartData = fc.values.slice(0, 15)
            const isHorizontal = chartData.some(v => v.value.length > 10)
            return (
              <ChartCard key={field.field_key} title={field.label} subtitle={`${fc.values.length} unique value${fc.values.length !== 1 ? 's' : ''}`}>
                {isHorizontal ? (
                  <ResponsiveContainer width="100%" height={Math.min(40 + chartData.length * 28, 320)}>
                    <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="value" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} width={120} />
                      <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} />
                      <Bar dataKey="count" fill="#6366F1" radius={[0, 3, 3, 0]} name="Count" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="value" tick={{ fontSize: 11, fill: tickFill }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: tickFill }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12, backgroundColor: theme === 'dark' ? '#1f2937' : '#fff', border: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb', color: theme === 'dark' ? '#f3f4f6' : '#111827' }} />
                      <Bar dataKey="count" fill="#6366F1" radius={[3, 3, 0, 0]} name="Count" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            )
          })}
        </div>
      )}

      {/* Session log */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Session Log
            {sessions && <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">{sessions.total} records</span>}
          </h3>
        </div>
        <div className="overflow-x-auto">
          {sessionsLoading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-6 py-3 text-left whitespace-nowrap">Date</th>
                  <th className="px-6 py-3 text-left whitespace-nowrap">MAC Address</th>
                  <th className="px-6 py-3 text-left whitespace-nowrap">IP</th>
                  <th className="px-6 py-3 text-left whitespace-nowrap">SSID</th>
                  {fieldDefs.map(f => (
                    <th key={f.field_key} className="px-6 py-3 text-left whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions?.items.map(session => (
                  <tr key={session.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                      {formatDateTime(session.authorized_at, tz, dateFormat)}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => {
                          setFilters(f => ({ ...f, mac: session.mac_address }))
                          setApplied(f => ({ ...f, mac: session.mac_address }))
                          setSearchParams({ mac: session.mac_address })
                          setPage(1)
                        }}
                        className="font-mono text-xs text-blue-600 hover:underline"
                      >
                        {session.mac_address}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{session.ip_address || '-'}</td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{session.ssid || '-'}</td>
                    {fieldDefs.map(f => (
                      <td key={f.field_key} className="px-6 py-3 text-gray-700 dark:text-gray-300 text-xs">
                        {session.form_data?.[f.field_key] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
                {!sessions?.items.length && (
                  <tr>
                    <td colSpan={4 + fieldDefs.length} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">
                      No sessions match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {sessions && sessions.pages > 1 && (
          <div className="flex items-center justify-center gap-2 p-4 border-t border-gray-100">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/50">← Prev</button>
            <span className="text-sm text-gray-500 dark:text-gray-400">Page {sessions.page} of {sessions.pages}</span>
            <button disabled={page === sessions.pages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/50">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'red'
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent === 'red' ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function ChartCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  )
}
