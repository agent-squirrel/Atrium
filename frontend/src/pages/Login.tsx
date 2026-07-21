import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { authApi } from '../api'
import { useAuthStore } from '../store/auth'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import AtriumLogo from '../components/ui/AtriumLogo'

const credSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
})
type CredData = z.infer<typeof credSchema>

export default function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)
  const [stage, setStage] = useState<'credentials' | 'totp'>('credentials')
  const [mfaToken, setMfaToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const totpRef = useRef<HTMLInputElement>(null)

  const DEVICE_TOKEN_KEY = 'trusted_device_token'

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CredData>({
    resolver: zodResolver(credSchema),
  })

  const onCredentials = async (data: CredData) => {
    try {
      const storedToken = localStorage.getItem(DEVICE_TOKEN_KEY) ?? undefined
      const { data: res } = await authApi.login(data.email, data.password, storedToken)
      if (res.requires_2fa && res.mfa_token) {
        setMfaToken(res.mfa_token)
        setStage('totp')
        setTimeout(() => totpRef.current?.focus(), 50)
        return
      }
      localStorage.setItem('access_token', res.access_token!)
      localStorage.setItem('refresh_token', res.refresh_token!)
      queryClient.clear()
      setUser(res.user!)
      const redirect = sessionStorage.getItem('login_redirect')
      sessionStorage.removeItem('login_redirect')
      navigate(redirect ?? '/')
    } catch (err: any) {
      if (err?.response?.status === 429) {
        toast.error('Too many attempts - please wait a minute')
      } else {
        toast.error('Invalid email or password')
      }
    }
  }

  const onTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (totpCode.length !== 6) return
    setTotpLoading(true)
    try {
      const { data: res } = await authApi.totpVerify(mfaToken, totpCode, rememberDevice)
      if (res.device_token) {
        localStorage.setItem(DEVICE_TOKEN_KEY, res.device_token)
      }
      localStorage.setItem('access_token', res.access_token)
      localStorage.setItem('refresh_token', res.refresh_token)
      queryClient.clear()
      setUser(res.user)
      const redirect = sessionStorage.getItem('login_redirect')
      sessionStorage.removeItem('login_redirect')
      navigate(redirect ?? '/')
    } catch (err: any) {
      if (err?.response?.status === 429) {
        toast.error('Too many attempts - please wait a minute')
      } else {
        toast.error('Invalid code')
        setTotpCode('')
        totpRef.current?.focus()
      }
    } finally {
      setTotpLoading(false)
    }
  }

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <AtriumLogo variant="white" className="h-16 mb-3" />
          <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
        </div>

        {stage === 'credentials' ? (
          <form onSubmit={handleSubmit(onCredentials)} className="bg-white rounded-2xl shadow-2xl p-8 space-y-5">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Sign in</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input {...register('email')} type="email" autoComplete="email" className={inp} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <input {...register('password')} type="password" autoComplete="current-password" className={inp} />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={onTotp} className="bg-white rounded-2xl shadow-2xl p-8 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <LockClosedIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Two-factor authentication</h2>
                <p className="text-xs text-gray-500">Enter the 6-digit code from your authenticator app</p>
              </div>
            </div>

            <input
              ref={totpRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className={`${inp} text-center text-2xl tracking-[0.5em] font-mono`}
            />

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={e => setRememberDevice(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Remember this device</span>
            </label>

            <button type="submit" disabled={totpLoading || totpCode.length !== 6}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {totpLoading ? 'Verifying…' : 'Verify'}
            </button>

            <button type="button" onClick={() => { reset(); setStage('credentials'); setTotpCode(''); setMfaToken('') }}
              className="w-full text-sm text-gray-500 hover:text-gray-700">
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
