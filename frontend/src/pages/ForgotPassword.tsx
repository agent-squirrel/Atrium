import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '../api'
import AtriumLogo from '../components/ui/AtriumLogo'

const schema = z.object({
  email: z.string().email('Invalid email'),
})
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [sent, setSent] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const mutation = useMutation({
    mutationFn: ({ email }: FormData) => authApi.forgotPassword(email),
    onSuccess: () => setSent(true),
    onError: () => setSent(true), // always show the same generic state - never reveal whether the email exists
  })

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #13233a 100%)' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <AtriumLogo variant="white" className="h-16 mb-3" />
          <p className="text-slate-400 text-sm">Multi-tenant captive portal management</p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-5 text-center">
            <h2 className="text-xl font-semibold text-gray-900">Check your email</h2>
            <p className="text-sm text-gray-500">
              If an account exists for that email, we've sent a link to reset your password. It expires in 1 hour.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="bg-white rounded-2xl shadow-2xl p-8 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Forgot password?</h2>
              <p className="text-sm text-gray-500 mt-1">Enter your email and we'll send you a reset link.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input {...register('email')} type="email" autoComplete="email" autoFocus className={inp} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting || mutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {mutation.isPending ? 'Sending…' : 'Send reset link'}
            </button>

            <button type="button" onClick={() => navigate('/login')}
              className="w-full text-sm text-gray-500 hover:text-gray-700">
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
