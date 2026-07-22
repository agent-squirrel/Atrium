import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { authApi } from '../api'
import AtriumLogo from '../components/ui/AtriumLogo'

const schema = z.object({
  password: z.string()
    .min(8, 'Too short - must be at least 8 characters')
    .regex(/\d/, 'Must include at least one number (0–9)')
    .regex(/[^a-zA-Z0-9]/, 'Must include at least one special character (e.g. ! @ # $)'),
  confirm_password: z.string(),
}).refine((d) => d.password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})
type FormData = z.infer<typeof schema>

export default function SetupAccountPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const mutation = useMutation({
    mutationFn: ({ password }: FormData) => authApi.setupAccount(token, password),
    onSuccess: () => {
      toast.success('Account set up. Please sign in.')
      navigate('/login')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Could not set up account')
    },
  })

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <AtriumLogo variant="white" className="h-16 mb-3" />
          <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
        </div>

        {!token ? (
          <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-5 text-center">
            <h2 className="text-xl font-semibold text-gray-900">Invalid link</h2>
            <p className="text-sm text-gray-500">This account setup link is missing its token. Ask whoever invited you to send a new one.</p>
            <button onClick={() => navigate('/login')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors">
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="bg-white rounded-2xl shadow-2xl p-8 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Set up your account</h2>
              <p className="text-sm text-gray-500 mt-1">Choose a password to finish setting up your account.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input {...register('password')} type="password" autoComplete="new-password" autoFocus className={inp} />
              <p className="text-xs text-gray-400 mt-1">At least 8 characters, including a number and special character (e.g. ! @ # $)</p>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input {...register('confirm_password')} type="password" autoComplete="new-password" className={inp} />
              {errors.confirm_password && <p className="text-red-500 text-xs mt-1">{errors.confirm_password.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting || mutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {mutation.isPending ? 'Setting up…' : 'Set up account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
