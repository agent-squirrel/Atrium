export type UserRole = 'superadmin' | 'admin' | 'client'

export interface UserTenantMembership {
  id: number
  user_id: number
  tenant_id: number
  tenant_name: string | null
  role: 'admin' | 'client'
}

export interface User {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string
  role: UserRole
  tenant_id: number | null
  tenant_name: string | null
  is_active: boolean
  totp_enabled: boolean
  memberships: UserTenantMembership[]
  created_at?: string
  last_login_at?: string | null
}

export interface AuditLog {
  id: number
  user_email: string | null
  action: string
  resource_type: string | null
  resource_id: number | null
  detail: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface Tenant {
  id: number
  name: string
  slug: string
  is_active: boolean
  created_at: string
}

export type ControllerAuthMode = 'password' | 'api_key'
export type ControllerType = 'self_hosted' | 'cloud'

export interface UnifiController {
  id: number
  name: string
  controller_type: ControllerType
  url: string | null
  auth_mode: ControllerAuthMode
  username: string | null
  has_api_key: boolean
  verify_ssl: boolean
  owner_type: 'platform' | 'tenant'
  tenant_id: number | null
  is_active: boolean
  maintenance_mode: boolean
  sync_interval_hours: number | null
  last_synced_at: string | null
  created_at: string
}

export interface UnifiSite {
  id: number
  unifi_site_id: string
  name: string
  description: string | null
  controller_id: number
  controller_name: string | null
  tenant_id: number | null
  tenant_name: string | null
  is_active: boolean
  created_at: string
  portal_count: number
}

export type AuthType = 'click_through' | 'voucher' | 'both'
export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'checkbox' | 'select' | 'textarea'
export type Layout = 'centered' | 'split'

export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Nunito', 'Raleway', 'Playfair Display', 'Merriweather',
  'Source Sans 3', 'Work Sans', 'DM Sans', 'Space Grotesk', 'Oswald',
] as const

export interface PortalField {
  id: number
  portal_id: number
  label: string
  field_key: string
  field_type: FieldType
  placeholder: string | null
  is_required: boolean
  options: string[] | null
  order: number
}

export interface Portal {
  id: number
  name: string
  slug: string
  site_id: number
  site_name: string | null
  ssids: string[]
  auth_type: AuthType
  is_active: boolean
  logo_path: string | null
  background_image_path: string | null
  primary_color: string
  secondary_color: string
  font_family: string | null
  layout: Layout
  card_opacity: number
  welcome_heading: string
  welcome_text: string | null
  disclaimer: string | null
  button_label: string
  require_terms_acceptance: boolean
  terms_checkbox_label: string | null
  terms_url: string | null
  social_facebook: string | null
  social_instagram: string | null
  social_twitter_x: string | null
  social_tiktok: string | null
  post_connect_heading: string
  post_connect_text: string | null
  promo_banner_path: string | null
  promo_banner_link: string | null
  redirect_url: string | null
  connect_delay_seconds: number
  session_duration: number
  rate_limit_down: number | null
  rate_limit_up: number | null
  data_retention_days: number | null
  maintenance_mode: boolean
  created_at: string
  updated_at: string
  portal_url: string
  dispatch_url: string
  fields?: PortalField[]
}

export interface GuestSession {
  id: number
  portal_id: number
  mac_address: string
  ip_address: string | null
  ap_mac: string | null
  ssid: string | null
  form_data: Record<string, string>
  auth_success: boolean
  auth_error: string | null
  authorized_at: string
  voucher_id: number | null
}

export interface UnifiDevice {
  mac: string
  hostname: string
  ip: string
  ssid: string
  ap_mac: string
  uptime: number | null
  signal: number | null
  authorized: boolean
}

export interface AnalyticsSummary {
  total_sessions: number
  unique_devices: number
  return_visitor_rate: number
  sessions_by_day: Array<{ date: string; count: number }>
  sessions_by_hour: Array<{ hour: number; count: number }>
  sessions_by_dow: Array<{ day: string; count: number }>
  auth_failures: {
    count: number
    rate: number
    top_errors: Array<{ error: string; count: number }>
  }
  top_aps: Array<{ ap_mac: string; name: string; count: number }>
  field_counts: Record<string, {
    label: string
    field_type: string
    values: Array<{ value: string; count: number }>
  }>
}

export interface Voucher {
  id: number
  portal_id: number
  code: string
  usage_limit: number
  usage_count: number
  duration_minutes: number
  rate_limit_down: number | null
  rate_limit_up: number | null
  is_active: boolean
  is_valid: boolean
  expires_at: string | null
  note: string | null
  created_at: string
  created_by_id: number | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pages: number
  per_page: number
}
