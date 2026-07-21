import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { authApi } from '../api'
import { useAuthStore } from '../store/auth'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { ShieldCheckIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline'

const inp = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'

export default function AccountPage() {
  const qc = useQueryClient()
  const setUser = useAuthStore(s => s.setUser)

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me().then(r => r.data),
  })

  // ── 2FA setup modal ────────────────────────────────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<'qr' | 'verify'>('qr')
  const [setupData, setSetupData] = useState<{ secret: string; qr_code: string } | null>(null)
  const [setupCode, setSetupCode] = useState('')

  const setupMutation = useMutation({
    mutationFn: () => authApi.totpSetup().then(r => r.data),
    onSuccess: data => {
      setSetupData(data)
      setSetupStep('qr')
      setSetupOpen(true)
    },
    onError: () => toast.error('Failed to start 2FA setup'),
  })

  const enableMutation = useMutation({
    mutationFn: (code: string) => authApi.totpEnable(code).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      if (me) setUser({ ...me, totp_enabled: true })
      setSetupOpen(false)
      setSetupCode('')
      toast.success('Two-factor authentication enabled')
    },
    onError: () => toast.error('Invalid code - try again'),
  })

  // ── 2FA disable modal ──────────────────────────────────────────────────────
  const [disableOpen, setDisableOpen] = useState(false)
  const [disableCode, setDisableCode] = useState('')

  const disableMutation = useMutation({
    mutationFn: (code: string) => authApi.totpDisable(code).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      if (me) setUser({ ...me, totp_enabled: false })
      setDisableOpen(false)
      setDisableCode('')
      toast.success('Two-factor authentication disabled')
    },
    onError: () => toast.error('Invalid code'),
  })

  // ── Change password ────────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')

  const changePwMutation = useMutation({
    mutationFn: () => authApi.changePassword(pwForm.current, pwForm.next),
    onSuccess: () => {
      setPwForm({ current: '', next: '', confirm: '' })
      setPwError('')
      toast.success('Password updated')
    },
    onError: (err: any) => setPwError(err?.response?.data?.error || 'Failed to update password'),
  })

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match'); return }
    if (pwForm.next.length < 8) { setPwError('Too short - must be at least 8 characters'); return }
    if (!/\d/.test(pwForm.next)) { setPwError('Must include at least one number (0–9)'); return }
    if (!/[^a-zA-Z0-9]/.test(pwForm.next)) { setPwError('Must include at least one special character (e.g. ! @ # $)'); return }
    setPwError('')
    changePwMutation.mutate()
  }

  if (isLoading) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading…</div>

  const totpEnabled = me?.totp_enabled ?? false

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title="Account" subtitle="Your profile and security settings" />

      {/* 2FA */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100">
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Two-Factor Authentication</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Protect your account with an authenticator app</p>
        </div>
        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {totpEnabled
              ? <ShieldCheckIcon className="w-8 h-8 text-green-500 flex-shrink-0" />
              : <ShieldExclamationIcon className="w-8 h-8 text-gray-300 flex-shrink-0" />
            }
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {totpEnabled ? 'Enabled' : 'Not enabled'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {totpEnabled
                  ? 'Your account requires a code from your authenticator app on login.'
                  : 'Add a second layer of security beyond your password.'}
              </p>
            </div>
          </div>
          {totpEnabled ? (
            <button onClick={() => setDisableOpen(true)}
              className="flex-shrink-0 text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 px-4 py-2 rounded-lg transition-colors">
              Disable
            </button>
          ) : (
            <button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}
              className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60">
              {setupMutation.isPending ? 'Loading…' : 'Set up 2FA'}
            </button>
          )}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100">
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Change Password</h2>
        </div>
        <form onSubmit={submitPassword} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current password</label>
            <input type="password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
              autoComplete="current-password" className={inp} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New password</label>
            <input type="password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
              autoComplete="new-password" className={inp} required />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">At least 8 characters, including a number and special character (e.g. ! @ # $)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm new password</label>
            <input type="password" value={pwForm.confirm}
              onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
              autoComplete="new-password" className={inp} required />
          </div>
          {pwError && <p className="text-red-500 text-sm">{pwError}</p>}
          <button type="submit" disabled={changePwMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-60">
            {changePwMutation.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* 2FA Setup modal */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Set up two-factor authentication" size="md">
        {setupStep === 'qr' && setupData && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
            </p>
            <div className="flex justify-center">
              {/* Fixed white chip regardless of theme - a dark-tinted QR code background isn't reliably scannable */}
              <div className="bg-white p-2 rounded border">
                <img src={setupData.qr_code} alt="2FA QR code" className="w-48 h-48" />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or enter this key manually:</p>
              <code className="block bg-gray-100 dark:bg-gray-700 rounded px-3 py-2 text-xs font-mono break-all text-center tracking-widest">
                {setupData.secret}
              </code>
            </div>
            <button onClick={() => setSetupStep('verify')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
              Next - enter code to confirm
            </button>
          </div>
        )}

        {setupStep === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Enter the 6-digit code from your authenticator app to confirm the setup.
            </p>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={setupCode}
              onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" autoFocus
              className={`${inp} text-center text-2xl tracking-[0.5em] font-mono`}
            />
            <div className="flex gap-3">
              <button onClick={() => setSetupStep('qr')}
                className="flex-1 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                Back
              </button>
              <button
                onClick={() => enableMutation.mutate(setupCode)}
                disabled={setupCode.length !== 6 || enableMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-60">
                {enableMutation.isPending ? 'Verifying…' : 'Enable 2FA'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Disable 2FA modal */}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Disable two-factor authentication" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Enter your current authenticator code to confirm you want to disable 2FA.
          </p>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={disableCode}
            onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000" autoFocus
            className={`${inp} text-center text-2xl tracking-[0.5em] font-mono`}
          />
          <div className="flex gap-3">
            <button onClick={() => { setDisableOpen(false); setDisableCode('') }}
              className="flex-1 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
              Cancel
            </button>
            <button
              onClick={() => disableMutation.mutate(disableCode)}
              disabled={disableCode.length !== 6 || disableMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-60">
              {disableMutation.isPending ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
