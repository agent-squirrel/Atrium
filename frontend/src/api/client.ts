import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// These endpoints return 401 as a normal "wrong credentials/code" response, not a
// signal that a session token expired - they must not trigger the refresh/redirect flow.
const PUBLIC_AUTH_PATHS = [
  '/auth/login', '/auth/totp/verify', '/setup/complete', '/setup/status',
  '/auth/forgot-password', '/auth/reset-password', '/setup/restore',
]

// On 401, try to refresh; on failure, send to login
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    const isPublicAuthCall = PUBLIC_AUTH_PATHS.some((p) => original?.url?.startsWith(p))
    if (err.response?.status === 401 && !original._retry && !isPublicAuthCall) {
      original._retry = true
      const refresh = localStorage.getItem('refresh_token')
      if (refresh) {
        try {
          const { data } = await axios.post('/api/auth/refresh', null, {
            headers: { Authorization: `Bearer ${refresh}` },
          })
          localStorage.setItem('access_token', data.access_token)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return api(original)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          sessionStorage.setItem('login_redirect', window.location.pathname)
          window.location.href = '/admin/login'
        }
      } else {
        sessionStorage.setItem('login_redirect', window.location.pathname)
        window.location.href = '/admin/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
