import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { portalsApi, guestsApi } from '../../api'
import PageHeader from '../../components/ui/PageHeader'
import {
  ArrowLeftIcon, ArrowPathIcon, NoSymbolIcon, CheckCircleIcon,
  ChartBarIcon, SignalIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

const REFRESH_OPTIONS = [
  { label: '10 seconds', value: 10_000 },
  { label: '30 seconds', value: 30_000 },
  { label: '1 minute',   value: 60_000 },
  { label: '2 minutes',  value: 120_000 },
  { label: '5 minutes',  value: 300_000 },
]
const DEFAULT_INTERVAL = 30_000

function formatUptime(seconds: number | null): string {
  if (seconds == null) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function SignalBars({ signal }: { signal: number | null }) {
  if (signal == null) return <span className="text-gray-300">-</span>
  const quality = signal >= -60 ? 'excellent' : signal >= -70 ? 'good' : signal >= -80 ? 'fair' : 'poor'
  const color = quality === 'excellent' ? 'text-green-500' : quality === 'good' ? 'text-blue-500' : quality === 'fair' ? 'text-yellow-500' : 'text-red-400'
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <SignalIcon className="w-3.5 h-3.5" />
      {signal} dBm
    </span>
  )
}

export default function GuestsPage() {
  const { id } = useParams<{ id: string }>()
  const portalId = parseInt(id!)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [refetchInterval, setRefetchInterval] = useState(DEFAULT_INTERVAL)

  const { data: portal } = useQuery({
    queryKey: ['portal', portalId],
    queryFn: () => portalsApi.get(portalId).then(r => r.data),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['active_devices', portalId],
    queryFn: () => guestsApi.activeDevices(portalId).then(r => r.data),
    refetchInterval,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['active_devices', portalId] })

  const { mutate: reconnect, isPending: reconnecting, variables: reconnectingMac } = useMutation({
    mutationFn: (mac: string) => guestsApi.reconnectDevice(portalId, mac),
    onSuccess: (res) => {
      if (res.data.ok) { toast.success('Device reconnected'); invalidate() }
      else toast.error(res.data.error ?? 'Reconnect failed')
    },
    onError: () => toast.error('Could not reach controller'),
  })

  const { mutate: unauthorize, isPending: unauthorizing, variables: unauthorizingMac } = useMutation({
    mutationFn: (mac: string) => guestsApi.unauthorizeDevice(portalId, mac),
    onSuccess: (res) => {
      if (res.data.ok) { toast.success('Device deauthorized'); invalidate() }
      else toast.error(res.data.error ?? 'Deauthorize failed')
    },
    onError: () => toast.error('Could not reach controller'),
  })

  const { mutate: authorize, isPending: authorizing, variables: authorizingMac } = useMutation({
    mutationFn: (mac: string) => guestsApi.authorizeDevice(portalId, mac),
    onSuccess: (res) => {
      if (res.data.ok) { toast.success('Device authorized'); invalidate() }
      else toast.error(res.data.error ?? 'Authorize failed')
    },
    onError: () => toast.error('Could not reach controller'),
  })

  const isPending = (mac: string) =>
    (reconnecting && reconnectingMac === mac) ||
    (unauthorizing && unauthorizingMac === mac) ||
    (authorizing && authorizingMac === mac)

  const devices = data?.devices ?? []
  const selectedOption = REFRESH_OPTIONS.find(o => o.value === refetchInterval)!

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portals" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <PageHeader
          title={`Active Devices - ${portal?.name ?? '...'}`}
          subtitle={`${devices.length} device${devices.length !== 1 ? 's' : ''} online`}
          action={
            <button
              onClick={() => navigate(`/portals/${portalId}/analytics`)}
              className="flex items-center gap-2 border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <ChartBarIcon className="w-4 h-4" /> Guest Analytics
            </button>
          }
        />
      </div>

      <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">Refresh every</label>
          <select
            value={refetchInterval}
            onChange={e => setRefetchInterval(Number(e.target.value))}
            className="border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {REFRESH_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {refetchInterval < 30_000 && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
            Shorter refresh intervals increase traffic and load on the UniFi controller.
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Fetching devices from controller...</div>
        ) : error || data?.error ? (
          <div className="p-8 text-center text-red-400">
            Could not reach the UniFi controller. Check connectivity and credentials.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Hostname</th>
                <th className="px-6 py-3 text-left">MAC Address</th>
                <th className="px-6 py-3 text-left">IP</th>
                <th className="px-6 py-3 text-left">SSID</th>
                <th className="px-6 py-3 text-left">Uptime</th>
                <th className="px-6 py-3 text-left">Signal</th>
                <th className="px-6 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devices.map(device => (
                <tr key={device.mac} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 text-gray-800 font-medium">
                    <div className="flex items-center gap-2">
                      {device.hostname || <span className="text-gray-400 dark:text-gray-500 italic">unknown</span>}
                      {!device.authorized && (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-full px-2 py-0.5">
                          Not authorized
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => navigate(`/portals/${portalId}/analytics?mac=${encodeURIComponent(device.mac)}`)}
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {device.mac}
                    </button>
                  </td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{device.ip || '-'}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{device.ssid || '-'}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatUptime(device.uptime)}</td>
                  <td className="px-6 py-3"><SignalBars signal={device.signal} /></td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      {!device.authorized && (
                        <button
                          onClick={() => authorize(device.mac)}
                          disabled={isPending(device.mac)}
                          className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          Authorize
                        </button>
                      )}
                      <button
                        onClick={() => reconnect(device.mac)}
                        disabled={isPending(device.mac)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowPathIcon className="w-3.5 h-3.5" />
                        Reconnect
                      </button>
                      <button
                        onClick={() => unauthorize(device.mac)}
                        disabled={isPending(device.mac)}
                        className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <NoSymbolIcon className="w-3.5 h-3.5" />
                        Deauthorize
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-400 dark:text-gray-500">
                    No devices currently connected through this portal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 text-right">
        Refreshes every {selectedOption.label.toLowerCase()}
      </p>
    </div>
  )
}
