import api from './client'
import type {
  User, UserTenantMembership, Tenant, UnifiController, UnifiSite,
  Portal, PortalField, GuestSession, Voucher, PaginatedResponse,
  UnifiDevice, AnalyticsSummary,
} from '../types'

// ── Setup ────────────────────────────────────────────────────────────────────

export const setupApi = {
  status: () => api.get<{ needs_setup: boolean }>('/setup/status'),
  complete: (data: { email: string; password: string; first_name: string; last_name: string; timezone?: string; date_format?: string }) =>
    api.post<{ access_token: string; refresh_token: string; user: User }>('/setup/complete', data),
  restore: (file: File, password?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (password) fd.append('password', password)
    return api.post<{ message: string }>('/setup/restore', fd)
  },
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string, device_token?: string) =>
    api.post<{ access_token?: string; refresh_token?: string; user?: User; requires_2fa?: boolean; mfa_token?: string }>(
      '/auth/login', { email, password, ...(device_token ? { device_token } : {}) }
    ),
  totpVerify: (mfa_token: string, code: string, remember_me?: boolean) =>
    api.post<{ access_token: string; refresh_token: string; user: User; device_token?: string }>(
      '/auth/totp/verify', { mfa_token, code, remember_me: remember_me ?? false }
    ),
  totpSetup: () =>
    api.post<{ secret: string; qr_code: string; uri: string }>('/auth/totp/setup'),
  totpEnable: (code: string) =>
    api.post<{ totp_enabled: boolean }>('/auth/totp/enable', { code }),
  totpDisable: (code: string) =>
    api.post<{ totp_enabled: boolean }>('/auth/totp/disable', { code }),
  me: () => api.get<User>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, new_password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, new_password }),
}

// ── Tenants ─────────────────────────────────────────────────────────────────

export const tenantsApi = {
  list: () => api.get<Tenant[]>('/tenants'),
  get: (id: number) => api.get<Tenant>(`/tenants/${id}`),
  create: (data: { name: string }) => api.post<Tenant>('/tenants', data),
  update: (id: number, data: Partial<Tenant>) => api.put<Tenant>(`/tenants/${id}`, data),
  delete: (id: number) => api.delete(`/tenants/${id}`),
}

// ── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get<User[]>('/users'),
  get: (id: number) => api.get<User>(`/users/${id}`),
  create: (data: Partial<User> & { password: string }) => api.post<User>('/users', data),
  update: (id: number, data: Partial<User> & { password?: string; tenant_id?: number | null }) =>
    api.put<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  addMembership: (userId: number, tenantId: number, role: string) =>
    api.post<UserTenantMembership>(`/users/${userId}/memberships`, { tenant_id: tenantId, role }),
  removeMembership: (userId: number, membershipId: number) =>
    api.delete(`/users/${userId}/memberships/${membershipId}`),
}

// ── Controllers ──────────────────────────────────────────────────────────────

export const controllersApi = {
  list: () => api.get<UnifiController[]>('/controllers'),
  get: (id: number) => api.get<UnifiController>(`/controllers/${id}`),
  create: (data: object) => api.post<UnifiController & { sync?: { synced: number; aps_synced: number } }>('/controllers', data),
  update: (id: number, data: object) => api.put<UnifiController>(`/controllers/${id}`, data),
  delete: (id: number) => api.delete(`/controllers/${id}`),
  sync: (id: number) => api.post<{ synced: number; sites: UnifiSite[] }>(`/controllers/${id}/sync`),
  test: (id: number) => api.post<{ ok: boolean; message: string }>(`/controllers/${id}/test`),
}

// ── Sites ────────────────────────────────────────────────────────────────────

export const sitesApi = {
  list: () => api.get<UnifiSite[]>('/sites'),
  get: (id: number) => api.get<UnifiSite>(`/sites/${id}`),
  update: (id: number, data: object) => api.put<UnifiSite>(`/sites/${id}`, data),
  listPortals: (id: number) => api.get<Portal[]>(`/sites/${id}/portals`),
  ssids: (id: number) => api.get<{ ssids: string[]; error?: string }>(`/sites/${id}/ssids`),
}

// ── Portals ──────────────────────────────────────────────────────────────────

export const portalsApi = {
  list: () => api.get<Portal[]>('/portals'),
  get: (id: number) => api.get<Portal>(`/portals/${id}`),
  create: (data: object) => api.post<Portal>('/portals', data),
  update: (id: number, data: object) => api.put<Portal>(`/portals/${id}`, data),
  delete: (id: number) => api.delete(`/portals/${id}`),

  listFields: (portalId: number) => api.get<PortalField[]>(`/portals/${portalId}/fields`),
  createField: (portalId: number, data: object) => api.post<PortalField>(`/portals/${portalId}/fields`, data),
  updateField: (portalId: number, fieldId: number, data: object) =>
    api.put<PortalField>(`/portals/${portalId}/fields/${fieldId}`, data),
  deleteField: (portalId: number, fieldId: number) =>
    api.delete(`/portals/${portalId}/fields/${fieldId}`),
  reorderFields: (portalId: number, order: number[]) =>
    api.post(`/portals/${portalId}/fields/reorder`, { order }),

  ssids: (portalId: number) => api.get<{ ssids: string[]; error?: string }>(`/portals/${portalId}/ssids`),

  uploadLogo: (portalId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ path: string }>(`/portals/${portalId}/upload/logo`, fd)
  },
  uploadBackground: (portalId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ path: string }>(`/portals/${portalId}/upload/background`, fd)
  },
  uploadPromoBanner: (portalId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ path: string }>(`/portals/${portalId}/upload/promo_banner`, fd)
  },
}

// ── Guests / Analytics ───────────────────────────────────────────────────────

export type GuestFilters = {
  page?: number
  per_page?: number
  search?: string
  mac?: string
  ssid?: string
  date_from?: string
  date_to?: string
}

export const guestsApi = {
  list: (portalId: number, params?: GuestFilters) =>
    api.get<PaginatedResponse<GuestSession>>(`/portals/${portalId}/guests`, { params }),
  get: (sessionId: number) => api.get<GuestSession>(`/guests/${sessionId}`),
  exportCsv: async (portalId: number, params?: Omit<GuestFilters, 'page' | 'per_page' | 'search'>) => {
    const res = await api.get(`/portals/${portalId}/guests/export`, {
      params,
      responseType: 'blob',
    })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `guests-portal-${portalId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  },

  activeDevices: (portalId: number) =>
    api.get<{ devices: UnifiDevice[]; error?: string }>(`/portals/${portalId}/active_devices`),

  summary: (portalId: number, params?: Omit<GuestFilters, 'page' | 'per_page' | 'search'>) =>
    api.get<AnalyticsSummary>(`/portals/${portalId}/guests/summary`, { params }),

  reconnectDevice: (portalId: number, mac: string) =>
    api.post<{ ok: boolean; error?: string }>(`/portals/${portalId}/devices/${mac}/reconnect`),
  unauthorizeDevice: (portalId: number, mac: string) =>
    api.post<{ ok: boolean; error?: string }>(`/portals/${portalId}/devices/${mac}/unauthorize`),
  authorizeDevice: (portalId: number, mac: string) =>
    api.post<{ ok: boolean; error?: string }>(`/portals/${portalId}/devices/${mac}/authorize`),
}

// ── Platform Settings ─────────────────────────────────────────────────────────

export type SettingEntry = { value: string; description: string }
export type PlatformSettings = {
  default_session_duration: SettingEntry
  default_rate_limit_down: SettingEntry
  default_rate_limit_up: SettingEntry
  guest_retention_days: SettingEntry
  maintenance_mode: SettingEntry
  root_redirect_url: SettingEntry
  admin_allowed_ips: SettingEntry
  session_remember_days: SettingEntry
  timezone: SettingEntry
  date_format: SettingEntry
}

export const settingsApi = {
  getMyIp: () => api.get<{ ip: string }>('/settings/my-ip'),
  getDisplaySettings: () => api.get<{ timezone: string; date_format: string }>('/settings/display'),
  getVersion: () => api.get<{ app_version: string; schema_revision: string | null }>('/settings/version'),
  get: () => api.get<PlatformSettings>('/settings'),
  update: (data: Record<string, string>) => api.put<PlatformSettings>('/settings', data),
  purgeGuests: () => api.post<{ deleted: number }>('/settings/purge-guests'),
  downloadBackup: async (password?: string) => {
    const res = await api.post('/settings/backup', { password }, { responseType: 'blob' })
    const disposition = res.headers['content-disposition'] as string | undefined
    const match = disposition?.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? `atrium-backup-${Date.now()}.atriumbak`
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },
}

// ── Email (SMTP) Settings ──────────────────────────────────────────────────

export type EmailSettings = {
  enabled: boolean
  smtp_host: string
  smtp_port: number | null
  smtp_username: string
  has_password: boolean
  from_address: string
  from_name: string
  encryption: 'none' | 'starttls' | 'ssl'
}

export const emailSettingsApi = {
  get: () => api.get<EmailSettings>('/settings/email'),
  update: (data: Partial<EmailSettings> & { password?: string }) =>
    api.put<EmailSettings>('/settings/email', data),
  test: (to?: string) => api.post<{ ok: boolean; message: string }>('/settings/email/test', { to }),
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

import type { AuditLog } from '../types'

export const auditApi = {
  list: (params?: { page?: number; per_page?: number; action?: string }) =>
    api.get<{ items: AuditLog[]; total: number; page: number; pages: number; per_page: number }>('/audit-log', { params }),
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardStats = {
  portals_total: number
  portals_active: number
  active_guests: number
  controllers?: number
  tenants?: number
}

export const dashboardApi = {
  stats: () => api.get<DashboardStats>('/dashboard/stats'),
}

// ── Vouchers ──────────────────────────────────────────────────────────────────

export const vouchersApi = {
  list: (portalId: number, activeOnly?: boolean) =>
    api.get<Voucher[]>(`/portals/${portalId}/vouchers`, { params: { active_only: activeOnly } }),
  create: (portalId: number, data: object) => api.post<Voucher[]>(`/portals/${portalId}/vouchers`, data),
  revoke: (voucherId: number) => api.delete<Voucher>(`/vouchers/${voucherId}`),
}
