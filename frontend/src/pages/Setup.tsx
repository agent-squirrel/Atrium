import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { setupApi } from '../api'
import { useAuthStore } from '../store/auth'
import AtriumLogo from '../components/ui/AtriumLogo'
import { DATE_FORMATS } from '../lib/datetime'

const schema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Too short - must be at least 8 characters')
    .regex(/\d/, 'Must include at least one number (0–9)')
    .regex(/[^a-zA-Z0-9]/, 'Must include at least one special character (e.g. ! @ # $)'),
  confirm_password: z.string(),
  timezone: z.string().min(1, 'Timezone is required'),
  date_format: z.string().min(1, 'Date format is required'),
}).refine((d) => d.password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

type FormData = z.infer<typeof schema>

// Intl.supportedValuesOf is ES2022; this project's tsconfig targets ES2020,
// so it's untyped here even though it's supported by all evergreen browsers.
const IntlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
const TIMEZONES: string[] = typeof IntlAny.supportedValuesOf === 'function'
  ? IntlAny.supportedValuesOf('timeZone')
  : ['UTC']
const DETECTED_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
// MM/DD/YYYY is genuinely a US-specific convention - everywhere else
// defaults to day-before-month, so guess from the browser's own locale.
const DETECTED_DATE_FORMAT = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en-US')
  ? 'MM/DD/YYYY'
  : 'DD/MM/YYYY'

export default function SetupPage() {
  const [step, setStep] = useState<'welcome' | 'form' | 'restore'>('welcome')
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: DETECTED_TIMEZONE, date_format: DETECTED_DATE_FORMAT },
  })

  const mutation = useMutation({
    mutationFn: ({ first_name, last_name, email, password, timezone, date_format }: FormData) =>
      setupApi.complete({ first_name, last_name, email, password, timezone, date_format }),
    onSuccess: ({ data }) => {
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      setUser(data.user)
      queryClient.setQueryData(['setup-status'], { needs_setup: false })
      toast.success('Setup complete - welcome!')
      navigate('/')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Setup failed, please try again')
    },
  })

  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePassword, setRestorePassword] = useState('')

  const restoreMutation = useMutation({
    mutationFn: () => {
      if (!restoreFile) throw new Error('No file selected')
      return setupApi.restore(restoreFile, restorePassword || undefined)
    },
    onSuccess: () => {
      queryClient.setQueryData(['setup-status'], { needs_setup: false })
      toast.success('Restore complete - sign in with your restored credentials.')
      navigate('/login')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Restore failed, please try again')
    },
  })

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <AtriumLogo variant="white" className="h-16 mb-3" />
            <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-5 text-center">
            <div className="w-14 h-14 bg-blue-100 rounded-2xl mx-auto flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-gray-900">Welcome - first time setup</h2>
              <p className="text-sm text-gray-500 mt-2">
                No administrator account exists yet. Create your superadmin account to get full access to all settings, tenants, and controllers.
              </p>
            </div>

            <button
              onClick={() => setStep('form')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Get started →
            </button>

            <button
              onClick={() => setStep('restore')}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Restore from backup
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'restore') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <AtriumLogo variant="white" className="h-12 mb-3" />
            <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); restoreMutation.mutate() }}
            className="bg-white rounded-2xl shadow-2xl p-8 space-y-4"
          >
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Restore from backup</h2>
              <p className="text-sm text-gray-500 mt-1">
                This replaces everything on this install with the contents of the backup file.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Backup file</label>
              <input
                type="file"
                accept=".atriumbak"
                onChange={e => setRestoreFile(e.target.files?.[0] ?? null)}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={restorePassword}
                onChange={e => setRestorePassword(e.target.value)}
                placeholder="Only needed if the backup is encrypted"
                autoComplete="off"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={!restoreFile || restoreMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {restoreMutation.isPending ? 'Restoring…' : 'Restore'}
            </button>

            <button
              type="button"
              onClick={() => setStep('welcome')}
              className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
            >
              ← Back
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <AtriumLogo variant="white" className="h-12 mb-3" />
          <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
        </div>

        <form
          onSubmit={handleSubmit((d) => mutation.mutate(d))}
          className="bg-white rounded-2xl shadow-2xl p-8 space-y-4"
        >
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Create superadmin account</h2>
            <p className="text-sm text-gray-500 mt-1">Step 2 of 2 - this account has full system access.</p>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input {...register('first_name')} className={inputClass} />
              {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name.message}</p>}
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input {...register('last_name')} className={inputClass} />
              {errors.last_name && <p className="text-red-500 text-xs mt-1">{errors.last_name.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input {...register('email')} type="email" autoComplete="email" className={inputClass} />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input {...register('password')} type="password" autoComplete="new-password" className={inputClass} />
            <p className="text-xs text-gray-400 mt-1">At least 8 characters, including a number and special character (e.g. ! @ # $)</p>
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
            <input {...register('confirm_password')} type="password" autoComplete="new-password" className={inputClass} />
            {errors.confirm_password && (
              <p className="text-red-500 text-xs mt-1">{errors.confirm_password.message}</p>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select {...register('timezone')} className={inputClass}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              {errors.timezone && <p className="text-red-500 text-xs mt-1">{errors.timezone.message}</p>}
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date format</label>
              <select {...register('date_format')} className={inputClass}>
                {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              {errors.date_format && <p className="text-red-500 text-xs mt-1">{errors.date_format.message}</p>}
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-2">Used to display dates and times throughout the admin panel.</p>

          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {mutation.isPending ? 'Creating account…' : 'Create account'}
          </button>

          <button
            type="button"
            onClick={() => setStep('welcome')}
            className="w-full text-sm text-gray-500 hover:text-gray-700 py-1"
          >
            ← Back
          </button>
        </form>
      </div>
    </div>
  )
}
