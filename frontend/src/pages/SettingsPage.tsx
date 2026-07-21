import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi, emailSettingsApi, type EmailSettings } from '../api'
import PageHeader from '../components/ui/PageHeader'
import Toggle from '../components/ui/Toggle'
import { useAuthStore } from '../store/auth'
import { DATE_FORMATS } from '../lib/datetime'
import {
  CheckCircleIcon, ExclamationCircleIcon,
  ExclamationTriangleIcon, ShieldExclamationIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

const input = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'
const inputSm = `${input} w-40`

type Form = {
  default_session_duration: string
  default_rate_limit_down: string
  default_rate_limit_up: string
  guest_retention_days: string
  maintenance_mode: string
  root_redirect_url: string
  admin_allowed_ips: string
  session_remember_days: string
  timezone: string
  date_format: string
}

const EMPTY: Form = {
  default_session_duration: '60',
  default_rate_limit_down: '',
  default_rate_limit_up: '',
  guest_retention_days: '',
  maintenance_mode: 'false',
  root_redirect_url: '',
  admin_allowed_ips: '',
  session_remember_days: '3',
  timezone: 'UTC',
  date_format: 'MM/DD/YYYY',
}

// Intl.supportedValuesOf is ES2022; this project's tsconfig targets ES2020,
// so it's untyped here even though it's supported by all evergreen browsers.
const IntlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
const TIMEZONES: string[] = typeof IntlAny.supportedValuesOf === 'function'
  ? IntlAny.supportedValuesOf('timeZone')
  : ['UTC']

const TABS = ['General', 'Guest', 'Security', 'Email', 'Backup'] as const
type Tab = typeof TABS[number]

type EmailForm = {
  enabled: boolean
  smtp_host: string
  smtp_port: string
  smtp_username: string
  password: string
  from_address: string
  from_name: string
  encryption: EmailSettings['encryption']
}

const EMAIL_EMPTY: EmailForm = {
  enabled: false,
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  password: '',
  from_address: '',
  from_name: '',
  encryption: 'starttls',
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: Tab = (TABS as readonly string[]).includes(searchParams.get('tab') ?? '')
    ? searchParams.get('tab') as Tab
    : 'General'
  const setActiveTab = (tab: Tab) => setSearchParams({ tab }, { replace: true })
  const [saved, setSaved] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['platform_settings'],
    queryFn: () => settingsApi.get().then(r => r.data),
  })

  const { data: myIpData } = useQuery({
    queryKey: ['my_ip'],
    queryFn: () => settingsApi.getMyIp().then(r => r.data),
    staleTime: Infinity,
  })

  const { data: versionData } = useQuery({
    queryKey: ['app_version'],
    queryFn: () => settingsApi.getVersion().then(r => r.data),
    staleTime: Infinity,
  })

  const [form, setForm] = useState<Form>(EMPTY)

  useEffect(() => {
    if (data) {
      setForm({
        default_session_duration: data.default_session_duration.value ?? '60',
        default_rate_limit_down: data.default_rate_limit_down.value ?? '',
        default_rate_limit_up: data.default_rate_limit_up.value ?? '',
        guest_retention_days: data.guest_retention_days.value ?? '',
        maintenance_mode: data.maintenance_mode.value ?? 'false',
        root_redirect_url: data.root_redirect_url.value ?? '',
        admin_allowed_ips: data.admin_allowed_ips.value ?? '',
        session_remember_days: data.session_remember_days.value ?? '3',
        timezone: data.timezone.value ?? 'UTC',
        date_format: data.date_format.value ?? 'MM/DD/YYYY',
      })
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform_settings'] })
      qc.invalidateQueries({ queryKey: ['platform_display_settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const purgeMutation = useMutation({
    mutationFn: () => settingsApi.purgeGuests(),
  })

  const set = (key: keyof Form) => (value: string) =>
    setForm(f => ({ ...f, [key]: value }))

  // Email (SMTP) settings - separate endpoint/table from the platform settings above.
  const { data: emailData, isLoading: emailLoading } = useQuery({
    queryKey: ['email_settings'],
    queryFn: () => emailSettingsApi.get().then(r => r.data),
  })

  const [emailForm, setEmailForm] = useState<EmailForm>(EMAIL_EMPTY)
  const [emailSaved, setEmailSaved] = useState(false)
  const currentUser = useAuthStore((s) => s.user)
  const [testTo, setTestTo] = useState('')

  useEffect(() => {
    if (currentUser?.email) setTestTo(t => t || currentUser.email)
  }, [currentUser])

  useEffect(() => {
    if (emailData) {
      setEmailForm({
        enabled: emailData.enabled,
        smtp_host: emailData.smtp_host,
        smtp_port: emailData.smtp_port ? String(emailData.smtp_port) : '',
        smtp_username: emailData.smtp_username,
        password: '',
        from_address: emailData.from_address,
        from_name: emailData.from_name,
        encryption: emailData.encryption,
      })
    }
  }, [emailData])

  const setEmail = (key: keyof EmailForm) => (value: string) =>
    setEmailForm(f => ({ ...f, [key]: value } as EmailForm))

  const saveEmailMutation = useMutation({
    mutationFn: () => emailSettingsApi.update({
      enabled: emailForm.enabled,
      smtp_host: emailForm.smtp_host,
      smtp_port: emailForm.smtp_port ? Number(emailForm.smtp_port) : null,
      smtp_username: emailForm.smtp_username,
      ...(emailForm.password ? { password: emailForm.password } : {}),
      from_address: emailForm.from_address,
      from_name: emailForm.from_name,
      encryption: emailForm.encryption,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email_settings'] })
      setEmailSaved(true)
      setTimeout(() => setEmailSaved(false), 3000)
    },
  })

  const testEmailMutation = useMutation({
    mutationFn: () => emailSettingsApi.test(testTo || undefined),
  })

  const [backupPassword, setBackupPassword] = useState('')
  const downloadBackupMutation = useMutation({
    mutationFn: () => settingsApi.downloadBackup(backupPassword || undefined),
  })

  if (isLoading) return <div className="text-gray-400 dark:text-gray-500 text-sm p-8">Loading…</div>

  const maintenanceOn = form.maintenance_mode === 'true'
  const hasIpRestriction = form.admin_allowed_ips.trim().length > 0
  const myIp = myIpData?.ip ?? ''
  const ipNotInList = hasIpRestriction && myIp &&
    !form.admin_allowed_ips.split('\n').some(cidr => cidr.trim() === `${myIp}/32` || cidr.trim() === myIp)

  const saveBar = (
    <div className="flex items-center gap-3 pt-2">
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
      >
        {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
      </button>
      {saved && (
        <span className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircleIcon className="w-4 h-4" /> Saved
        </span>
      )}
      {saveMutation.isError && (
        <span className="flex items-center gap-1.5 text-sm text-red-600">
          <ExclamationCircleIcon className="w-4 h-4" /> Failed to save
        </span>
      )}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="Platform-wide configuration options" />

      {/* Tab bar */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* General tab */}
      {activeTab === 'General' && (
        <div className="space-y-6">
          <Section title="Localization" subtitle="Used to display dates and times throughout the admin panel.">
            <Field label="Timezone" description={data?.timezone.description}>
              <select
                value={form.timezone}
                onChange={e => set('timezone')(e.target.value)}
                className={input}
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
            <Field label="Date format" description={data?.date_format.description}>
              <select
                value={form.date_format}
                onChange={e => set('date_format')(e.target.value)}
                className={inputSm}
              >
                {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Routing" subtitle="Control how traffic is handled at the root of this server.">
            <Field label="Root URL redirect" description={data?.root_redirect_url.description}>
              <input
                type="text"
                value={form.root_redirect_url}
                onChange={e => set('root_redirect_url')(e.target.value)}
                placeholder="https://example.com"
                className={input}
              />
            </Field>
          </Section>

          {versionData && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              Atrium v{versionData.app_version}
              {versionData.schema_revision && <> &middot; schema {versionData.schema_revision}</>}
            </p>
          )}

          {saveBar}
        </div>
      )}

      {/* Guest tab */}
      {activeTab === 'Guest' && (
        <div className="space-y-6">
          <Section title="Portal Defaults" subtitle="Applied to all portals unless overridden per-portal.">
            <Field label="Default session duration" description={data?.default_session_duration.description}>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={10080}
                  value={form.default_session_duration}
                  onChange={e => set('default_session_duration')(e.target.value)}
                  className={inputSm}
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">minutes</span>
              </div>
            </Field>

            <Field label="Default bandwidth limits" description="Applied to guests who connect without a voucher. Leave blank for no limit.">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-16 text-right">Download</span>
                  <input
                    type="number" min={0}
                    value={form.default_rate_limit_down}
                    onChange={e => set('default_rate_limit_down')(e.target.value)}
                    placeholder="No limit"
                    className={inputSm}
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">kbps</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-16 text-right">Upload</span>
                  <input
                    type="number" min={0}
                    value={form.default_rate_limit_up}
                    onChange={e => set('default_rate_limit_up')(e.target.value)}
                    placeholder="No limit"
                    className={inputSm}
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">kbps</span>
                </div>
              </div>
            </Field>

            <Field label="Maintenance mode" description={data?.maintenance_mode.description}>
              <Toggle
                checked={maintenanceOn}
                onChange={on => set('maintenance_mode')(on ? 'true' : 'false')}
              />
              {maintenanceOn && (
                <p className="mt-2 text-xs text-amber-600 font-medium">
                  All guest portals are showing the maintenance page.
                </p>
              )}
            </Field>
          </Section>

          <Section title="Guest Data" subtitle="Control how long session records are kept.">
            <Field label="Data retention" description={data?.guest_retention_days.description}>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1}
                  value={form.guest_retention_days}
                  onChange={e => set('guest_retention_days')(e.target.value)}
                  placeholder="Never"
                  className={inputSm}
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
              </div>
            </Field>

            <Field label="Purge now" description="Immediately delete all guest sessions that exceed the configured retention period.">
              <button
                onClick={() => purgeMutation.mutate()}
                disabled={purgeMutation.isPending}
                className="border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm font-medium text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {purgeMutation.isPending ? 'Purging…' : 'Purge Old Records'}
              </button>
              {purgeMutation.isSuccess && (
                <p className="mt-1.5 text-xs text-green-600">
                  Deleted {purgeMutation.data?.data.deleted ?? 0} session(s).
                </p>
              )}
            </Field>

            <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-4 py-3 font-mono leading-relaxed">
              <p className="font-sans font-medium text-gray-500 dark:text-gray-400 mb-1">Automate via cron:</p>
              docker compose exec backend flask purge-guest-data
            </div>
          </Section>

          {saveBar}
        </div>
      )}

      {/* Security tab */}
      {activeTab === 'Security' && (
        <div className="space-y-6">
          <Section title="Sessions">
            <Field label="Remember login for" description={data?.session_remember_days.description}>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={365}
                  value={form.session_remember_days}
                  onChange={e => set('session_remember_days')(e.target.value)}
                  placeholder="3"
                  className={inputSm}
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
              </div>
            </Field>
          </Section>

          <Section title="Admin IP Restriction" subtitle="Restrict which IP addresses can reach the admin API.">
            <div className="flex gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
              <ShieldExclamationIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-400 space-y-1">
                <p className="font-semibold">Getting this wrong will lock you out of the admin panel.</p>
                <p>Ensure your current IP is included before saving. If you get locked out, run this from the server:</p>
                <code className="block bg-red-100 dark:bg-red-900/40 rounded px-2 py-1 font-mono text-xs mt-1">
                  docker compose exec backend flask clear-admin-ip-restriction
                </code>
              </div>
            </div>

            <Field
              label="Allowed IP ranges"
              description="One CIDR per line (e.g. 192.168.1.0/24 or 203.0.113.5/32). Leave blank to allow all IPs."
            >
              {myIp && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Your current IP:{' '}
                  <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{myIp}</span>
                  {hasIpRestriction && ipNotInList && (
                    <span className="ml-2 text-amber-600 font-medium">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 inline -mt-0.5" /> not in your list
                    </span>
                  )}
                </p>
              )}
              <textarea
                value={form.admin_allowed_ips}
                onChange={e => set('admin_allowed_ips')(e.target.value)}
                rows={5}
                placeholder={"192.168.1.0/24\n10.0.0.0/8"}
                className={`${input} font-mono`}
              />
            </Field>
          </Section>

          {saveBar}
        </div>
      )}

      {/* Email tab */}
      {activeTab === 'Email' && (
        emailLoading ? <div className="text-gray-400 dark:text-gray-500 text-sm">Loading…</div> : (
        <div className="space-y-6">
          <Section title="Outgoing Mail" subtitle="Used to send password reset links to admin users.">
            <Field label="Enabled">
              <Toggle
                checked={emailForm.enabled}
                onChange={on => setEmailForm(f => ({ ...f, enabled: on }))}
              />
            </Field>

            <Field label="SMTP host">
              <input
                type="text"
                value={emailForm.smtp_host}
                onChange={e => setEmail('smtp_host')(e.target.value)}
                placeholder="smtp.mailgun.org"
                className={input}
              />
            </Field>

            <div className="flex flex-wrap gap-4">
              <Field label="Port">
                <input
                  type="number" min={1} max={65535}
                  value={emailForm.smtp_port}
                  onChange={e => setEmail('smtp_port')(e.target.value)}
                  placeholder="587"
                  className={inputSm}
                />
              </Field>

              <Field label="Encryption">
                <select
                  value={emailForm.encryption}
                  onChange={e => setEmail('encryption')(e.target.value)}
                  className={inputSm}
                >
                  <option value="starttls">STARTTLS</option>
                  <option value="ssl">SSL</option>
                  <option value="none">None</option>
                </select>
              </Field>
            </div>

            <Field label="Username">
              <input
                type="text"
                value={emailForm.smtp_username}
                onChange={e => setEmail('smtp_username')(e.target.value)}
                className={input}
              />
            </Field>

            <Field label="Password" description={emailData?.has_password ? 'A password is already saved. Leave blank to keep it.' : undefined}>
              <input
                type="password"
                value={emailForm.password}
                onChange={e => setEmail('password')(e.target.value)}
                placeholder={emailData?.has_password ? '••••••••' : ''}
                autoComplete="new-password"
                className={input}
              />
            </Field>

            <div className="flex flex-wrap gap-4">
              <Field label="From address">
                <input
                  type="email"
                  value={emailForm.from_address}
                  onChange={e => setEmail('from_address')(e.target.value)}
                  placeholder="noreply@example.com"
                  className={input}
                />
              </Field>

              <Field label="From name">
                <input
                  type="text"
                  value={emailForm.from_name}
                  onChange={e => setEmail('from_name')(e.target.value)}
                  placeholder="Atrium"
                  className={input}
                />
              </Field>
            </div>
          </Section>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => saveEmailMutation.mutate()}
              disabled={saveEmailMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {saveEmailMutation.isPending ? 'Saving…' : 'Save Settings'}
            </button>
            {emailSaved && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircleIcon className="w-4 h-4" /> Saved
              </span>
            )}
            {saveEmailMutation.isError && (
              <span className="flex items-center gap-1.5 text-sm text-red-600">
                <ExclamationCircleIcon className="w-4 h-4" /> Failed to save
              </span>
            )}
          </div>

          <Section title="Send Test Email">
            <Field label="Send to">
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={testTo}
                  onChange={e => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                  className={input}
                />
                <button
                  onClick={() => testEmailMutation.mutate()}
                  disabled={testEmailMutation.isPending}
                  className="border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm font-medium text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {testEmailMutation.isPending ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              {testEmailMutation.isSuccess && (
                <p className={clsx('mt-1.5 text-xs', testEmailMutation.data?.data.ok ? 'text-green-600' : 'text-red-600')}>
                  {testEmailMutation.data?.data.message}
                </p>
              )}
              {testEmailMutation.isError && (
                <p className="mt-1.5 text-xs text-red-600">Failed to send test email.</p>
              )}
            </Field>
          </Section>
        </div>
        )
      )}

      {/* Backup tab */}
      {activeTab === 'Backup' && (
        <div className="space-y-6">
          <Section title="Download Backup" subtitle="Everything: settings, portals, users, guest history, and uploaded images. Restore it onto a fresh install from the setup wizard.">
            <Field label="Password (optional)">
              <input
                type="password"
                value={backupPassword}
                onChange={e => setBackupPassword(e.target.value)}
                placeholder="Leave blank for no encryption"
                autoComplete="new-password"
                className={input}
              />
              {backupPassword ? (
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  The file will be encrypted. You'll need this password to restore it.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-amber-600">
                  Without a password, this file will contain your UniFi controller and SMTP
                  credentials in plain text. Store it securely, or set a password.
                </p>
              )}
            </Field>

            <div className="pt-1">
              <button
                onClick={() => downloadBackupMutation.mutate()}
                disabled={downloadBackupMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                {downloadBackupMutation.isPending ? 'Preparing…' : 'Download Backup'}
              </button>
              {downloadBackupMutation.isError && (
                <p className="mt-1.5 text-xs text-red-600">Failed to create backup.</p>
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100">
      <div className="px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  )
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
      <div className="pt-1">{children}</div>
    </div>
  )
}

