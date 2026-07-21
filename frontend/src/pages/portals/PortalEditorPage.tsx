import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useSearchParams, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { portalsApi } from '../../api'
import { ExclamationTriangleIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import Toggle from '../../components/ui/Toggle'
import PageHeader from '../../components/ui/PageHeader'
import FieldBuilder from '../../components/FieldBuilder/FieldBuilder'
import type { AuthType, Layout } from '../../types'
import { GOOGLE_FONTS } from '../../types'
import { useAuthStore } from '../../store/auth'

const input = 'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500'

const TABS = ['General', 'Content', 'Post-Connect', 'Appearance', 'Session'] as const
type Tab = typeof TABS[number]

export default function PortalEditorPage() {
  const user = useAuthStore(s => s.user)
  const canManage = user?.role === 'superadmin' || user?.role === 'admin'
    || (user?.memberships ?? []).some(m => m.role === 'admin')
  if (!canManage) return <Navigate to="/portals" replace />

  const { id } = useParams<{ id: string }>()
  const portalId = parseInt(id!)
  const qc = useQueryClient()
  const logoRef = useRef<HTMLInputElement>(null)
  const bgRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: Tab = (TABS as readonly string[]).includes(searchParams.get('tab') ?? '')
    ? searchParams.get('tab') as Tab
    : 'General'
  const setActiveTab = (tab: Tab) => setSearchParams({ tab }, { replace: true })

  const { data: portal, isLoading } = useQuery({
    queryKey: ['portal', portalId],
    queryFn: () => portalsApi.get(portalId).then(r => r.data),
  })

  const { data: ssidsData } = useQuery({
    queryKey: ['portal_ssids', portalId],
    queryFn: () => portalsApi.ssids(portalId).then(r => r.data),
    enabled: !!portal,
  })

  const [form, setForm] = useState({
    name: '',
    auth_type: 'click_through' as AuthType,
    ssids: [] as string[],
    welcome_heading: '',
    welcome_text: '',
    disclaimer: '',
    button_label: '',
    primary_color: '#3B82F6',
    secondary_color: '#1E40AF',
    font_family: 'Inter',
    layout: 'centered' as Layout,
    card_opacity: 97,
    require_terms_acceptance: false,
    terms_checkbox_label: '',
    terms_url: '',
    social_facebook: '',
    social_instagram: '',
    social_twitter_x: '',
    social_tiktok: '',
    post_connect_heading: '',
    post_connect_text: '',
    promo_banner_link: '',
    redirect_url: '',
    connect_delay_seconds: 5,
    session_duration: 60,
    rate_limit_down: '' as unknown as number,
    rate_limit_up: '' as unknown as number,
    data_retention_days: '' as unknown as number,
    is_active: true,
    maintenance_mode: false,
  })

  // Hydrate form state once per portal load, not on every refetch of the same
  // portal - FieldBuilder and the logo/background uploaders invalidate the
  // ['portal', portalId] query for their own data (fields list, image paths),
  // and re-running this on every such refetch would clobber any unsaved edits
  // the user is mid-typing in other tabs.
  const hydratedPortalId = useRef<number | null>(null)
  useEffect(() => {
    if (portal && hydratedPortalId.current !== portal.id) {
      hydratedPortalId.current = portal.id
      setForm({
        name: portal.name,
        auth_type: portal.auth_type,
        ssids: portal.ssids || [],
        welcome_heading: portal.welcome_heading || '',
        welcome_text: portal.welcome_text || '',
        disclaimer: portal.disclaimer || '',
        button_label: portal.button_label || 'Connect',
        primary_color: portal.primary_color,
        secondary_color: portal.secondary_color,
        font_family: portal.font_family || 'Inter',
        layout: portal.layout || 'centered',
        card_opacity: portal.card_opacity,
        require_terms_acceptance: portal.require_terms_acceptance,
        terms_checkbox_label: portal.terms_checkbox_label || '',
        terms_url: portal.terms_url || '',
        social_facebook: portal.social_facebook || '',
        social_instagram: portal.social_instagram || '',
        social_twitter_x: portal.social_twitter_x || '',
        social_tiktok: portal.social_tiktok || '',
        post_connect_heading: portal.post_connect_heading || '',
        post_connect_text: portal.post_connect_text || '',
        promo_banner_link: portal.promo_banner_link || '',
        redirect_url: portal.redirect_url || '',
        connect_delay_seconds: portal.connect_delay_seconds,
        session_duration: portal.session_duration,
        rate_limit_down: (portal.rate_limit_down ?? '') as unknown as number,
        rate_limit_up: (portal.rate_limit_up ?? '') as unknown as number,
        data_retention_days: (portal.data_retention_days ?? '') as unknown as number,
        is_active: portal.is_active,
        maintenance_mode: portal.maintenance_mode,
      })
    }
  }, [portal])

  const saveMutation = useMutation({
    mutationFn: () => portalsApi.update(portalId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      qc.invalidateQueries({ queryKey: ['portals'] })
      toast.success('Portal saved')
    },
    onError: () => toast.error('Save failed'),
  })

  const uploadLogo = async (file: File) => {
    try {
      await portalsApi.uploadLogo(portalId, file)
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      toast.success('Logo uploaded')
    } catch {
      toast.error('Upload failed')
    }
  }

  const uploadBg = async (file: File) => {
    try {
      await portalsApi.uploadBackground(portalId, file)
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      toast.success('Background uploaded')
    } catch {
      toast.error('Upload failed')
    }
  }

  const uploadBanner = async (file: File) => {
    try {
      await portalsApi.uploadPromoBanner(portalId, file)
      qc.invalidateQueries({ queryKey: ['portal', portalId] })
      toast.success('Promo banner uploaded')
    } catch {
      toast.error('Upload failed')
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading…</div>
  if (!portal) return <div className="p-8 text-red-500">Portal not found</div>

  const f = (key: keyof typeof form) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portals" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <PageHeader title={`Edit: ${portal.name}`} subtitle={`/p/${portal.slug}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left column: tabbed settings */}
        <div className="lg:col-span-2">
          {/* Tab bar */}
          <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
            <nav className="-mb-px flex gap-6">
              {TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={clsx(
                    'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
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

          <div className="space-y-6">
            {/* General tab */}
            {activeTab === 'General' && (
              <>
                <Field label="Portal Name">
                  <input {...f('name')} className={input} />
                </Field>

                <Field label="Auth Type">
                  <select {...f('auth_type')} className={input}>
                    <option value="click_through">Click-through</option>
                    <option value="voucher">Voucher only</option>
                    <option value="both">Both</option>
                  </select>
                </Field>

                <Field label="SSID filter">
                  {ssidsData?.error && (
                    <p className="flex items-center gap-1 text-xs text-amber-600 mb-1">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                      Could not fetch SSIDs from controller
                    </p>
                  )}
                  <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-3 space-y-2 max-h-56 overflow-y-auto">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={form.ssids.length === 0}
                        onChange={() => setForm(p => ({ ...p, ssids: [] }))}
                        className="w-4 h-4 accent-blue-600"
                      />
                      All SSIDs
                    </label>
                    {(ssidsData?.ssids ?? []).map(s => (
                      <label key={s} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={form.ssids.includes(s)}
                          onChange={e => setForm(p => ({
                            ...p,
                            ssids: e.target.checked ? [...p.ssids, s] : p.ssids.filter(x => x !== s),
                          }))}
                          className="w-4 h-4 accent-blue-600"
                        />
                        {s}
                      </label>
                    ))}
                    {form.ssids.filter(s => !ssidsData?.ssids.includes(s)).map(s => (
                      <label key={s} className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => setForm(p => ({ ...p, ssids: p.ssids.filter(x => x !== s) }))}
                          className="w-4 h-4 accent-blue-600"
                        />
                        {s} (not seen on controller)
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Select specific SSIDs, or leave on "All SSIDs" to match every SSID on this site.</p>
                </Field>

                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
                  <Toggle
                    checked={form.is_active}
                    onChange={on => setForm(p => ({ ...p, is_active: on }))}
                    label="Portal active"
                    description={form.is_active ? undefined : 'Portal is disabled and will not accept new connections.'}
                    activeColor="bg-blue-600"
                  />
                  <div className="border-t border-gray-100" />
                  <Toggle
                    checked={form.maintenance_mode}
                    onChange={on => setForm(p => ({ ...p, maintenance_mode: on }))}
                    label="Maintenance mode"
                    description={form.maintenance_mode ? 'Guests will see a maintenance page instead of the portal form.' : undefined}
                  />
                </div>
              </>
            )}

            {/* Content tab */}
            {activeTab === 'Content' && (
              <>
                <Field label="Welcome Heading">
                  <input {...f('welcome_heading')} placeholder="Welcome" className={input} />
                </Field>
                <Field label="Welcome Message">
                  <textarea {...f('welcome_text')} rows={3} placeholder="Optional message shown above the form…" className={input} />
                </Field>
                <Field label="Connect Button Label">
                  <input {...f('button_label')} placeholder="Connect" className={input} />
                </Field>
                <Field label="Disclaimer">
                  <textarea {...f('disclaimer')} rows={4} placeholder="By connecting you agree to our terms…" className={input} />
                </Field>

                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
                  <Toggle
                    checked={form.require_terms_acceptance}
                    onChange={on => setForm(p => ({ ...p, require_terms_acceptance: on }))}
                    label="Require explicit Terms & Conditions acceptance"
                    description={form.require_terms_acceptance ? 'Guests must check a box before the Connect button is enabled.' : undefined}
                    activeColor="bg-blue-600"
                  />
                  {form.require_terms_acceptance && (
                    <Field label="Checkbox label">
                      <input {...f('terms_checkbox_label')} placeholder="I agree to the Terms & Conditions" className={input} />
                    </Field>
                  )}
                  <Field label="Terms / Privacy Policy URL">
                    <input {...f('terms_url')} placeholder="https://example.com/terms" className={input} />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {form.require_terms_acceptance
                        ? 'Makes the checkbox label above a link to this page.'
                        : 'Shown as a "View full policy" link next to the disclaimer.'}
                    </p>
                  </Field>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  {portal.fields !== undefined && (
                    <FieldBuilder portalId={portalId} fields={portal.fields} />
                  )}
                </div>
              </>
            )}

            {/* Post-Connect tab */}
            {activeTab === 'Post-Connect' && (
              <>
                <Field label="Post-Connect Heading">
                  <input {...f('post_connect_heading')} placeholder="You're Connected!" className={input} />
                </Field>
                <Field label="Post-Connect Message">
                  <textarea {...f('post_connect_text')} rows={3} placeholder="Optional message shown after a guest connects…" className={input} />
                </Field>

                <Field label="Promo Banner">
                  <div className="flex items-center gap-4">
                    {portal.promo_banner_path
                      ? <img src={portal.promo_banner_path} alt="Promo banner" className="h-14 w-24 object-cover border rounded" />
                      : <div className="h-14 w-24 rounded border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">No banner</div>
                    }
                    <button
                      onClick={() => bannerRef.current?.click()}
                      className="text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      {portal.promo_banner_path ? 'Replace' : 'Upload Banner'}
                    </button>
                    <input ref={bannerRef} type="file" accept="image/*" className="hidden"
                      onChange={e => e.target.files?.[0] && uploadBanner(e.target.files[0])} />
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Shown on the post-connect page, e.g. a promo or special offer.</p>
                </Field>
                <Field label="Promo Banner Link (optional)">
                  <input {...f('promo_banner_link')} placeholder="https://example.com/menu" className={input} />
                </Field>

                <Field label="Connection countdown (seconds)">
                  <input
                    type="number" min={0}
                    value={form.connect_delay_seconds as unknown as string}
                    onChange={e => setForm(p => ({ ...p, connect_delay_seconds: (parseInt(e.target.value) || 0) as unknown as number }))}
                    className={input}
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    How long this page shows before the guest is actually connected (and, if set below, redirected). Keeping this
                    above 0 guarantees the post-connect page is visible even on devices that auto-close the WiFi login screen
                    the instant they detect internet access.
                  </p>
                </Field>
                <Field label="Post-connect redirect URL">
                  <input {...f('redirect_url')} placeholder="https://example.com" className={input} />
                </Field>
              </>
            )}

            {/* Appearance tab */}
            {activeTab === 'Appearance' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Primary Colour">
                    <div className="flex gap-2 items-center">
                      <input
                        type="color" value={form.primary_color}
                        onChange={e => setForm(p => ({ ...p, primary_color: e.target.value }))}
                        className="w-10 h-10 rounded cursor-pointer border border-gray-200 dark:border-gray-700 flex-shrink-0"
                      />
                      <input {...f('primary_color')} className={`${input} font-mono`} />
                    </div>
                  </Field>
                  <Field label="Secondary Colour">
                    <div className="flex gap-2 items-center">
                      <input
                        type="color" value={form.secondary_color}
                        onChange={e => setForm(p => ({ ...p, secondary_color: e.target.value }))}
                        className="w-10 h-10 rounded cursor-pointer border border-gray-200 dark:border-gray-700 flex-shrink-0"
                      />
                      <input {...f('secondary_color')} className={`${input} font-mono`} />
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Font">
                    <select {...f('font_family')} className={input}>
                      {GOOGLE_FONTS.map(fontName => (
                        <option key={fontName} value={fontName}>{fontName}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Layout">
                    <select {...f('layout')} className={input}>
                      <option value="centered">Centered card</option>
                      <option value="split">Split screen</option>
                    </select>
                  </Field>
                </div>

                {form.layout !== 'split' && (
                  <Field label={`Card Opacity (${form.card_opacity}%)`}>
                    <input
                      type="range" min={0} max={100}
                      value={form.card_opacity}
                      onChange={e => setForm(p => ({ ...p, card_opacity: parseInt(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Lower values reveal more of the background image/colour through a frosted-glass card.</p>
                  </Field>
                )}

                <Field label="Logo">
                  <div className="flex items-center gap-4">
                    {portal.logo_path
                      ? <img src={portal.logo_path} alt="Logo" className="h-14 object-contain border rounded p-1" />
                      : <div className="h-14 w-24 rounded border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">No logo</div>
                    }
                    <button
                      onClick={() => logoRef.current?.click()}
                      className="text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      {portal.logo_path ? 'Replace' : 'Upload Logo'}
                    </button>
                    <input ref={logoRef} type="file" accept="image/*" className="hidden"
                      onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                  </div>
                </Field>

                <Field label="Background Image">
                  <div className="flex items-center gap-4">
                    {portal.background_image_path
                      ? <img src={portal.background_image_path} alt="Background" className="h-14 w-24 object-cover border rounded" />
                      : <div className="h-14 w-24 rounded border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">No image</div>
                    }
                    <button
                      onClick={() => bgRef.current?.click()}
                      className="text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      {portal.background_image_path ? 'Replace' : 'Upload Background'}
                    </button>
                    <input ref={bgRef} type="file" accept="image/*" className="hidden"
                      onChange={e => e.target.files?.[0] && uploadBg(e.target.files[0])} />
                  </div>
                </Field>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Social Links</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500 -mt-3">Shown as icons in the footer of the guest page. Leave blank to hide.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Facebook URL">
                      <input {...f('social_facebook')} placeholder="https://facebook.com/..." className={input} />
                    </Field>
                    <Field label="Instagram URL">
                      <input {...f('social_instagram')} placeholder="https://instagram.com/..." className={input} />
                    </Field>
                    <Field label="X (Twitter) URL">
                      <input {...f('social_twitter_x')} placeholder="https://x.com/..." className={input} />
                    </Field>
                    <Field label="TikTok URL">
                      <input {...f('social_tiktok')} placeholder="https://tiktok.com/@..." className={input} />
                    </Field>
                  </div>
                </div>
              </>
            )}

            {/* Session tab */}
            {activeTab === 'Session' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Session duration (minutes)">
                  <input
                    type="number" min={0}
                    value={form.session_duration}
                    onChange={e => setForm(p => ({ ...p, session_duration: parseInt(e.target.value) || 0 }))}
                    placeholder="0 = global default"
                    className={input}
                  />
                </Field>
                <Field label="Download limit (kbps)">
                  <input
                    type="number" min={0}
                    value={form.rate_limit_down as unknown as string}
                    onChange={e => setForm(p => ({ ...p, rate_limit_down: e.target.value as unknown as number }))}
                    placeholder="Blank = global default"
                    className={input}
                  />
                </Field>
                <Field label="Upload limit (kbps)">
                  <input
                    type="number" min={0}
                    value={form.rate_limit_up as unknown as string}
                    onChange={e => setForm(p => ({ ...p, rate_limit_up: e.target.value as unknown as number }))}
                    placeholder="Blank = global default"
                    className={input}
                  />
                </Field>
                <Field label="Data retention (days)">
                  <input
                    type="number" min={1}
                    value={form.data_retention_days as unknown as string}
                    onChange={e => setForm(p => ({ ...p, data_retention_days: e.target.value as unknown as number }))}
                    placeholder="Blank = global default"
                    className={input}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Right column: sticky save panel */}
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 sticky top-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Portal</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Public URL</p>
            <a
              href={`/p/${portal.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-blue-600 px-3 py-2 rounded mb-4 break-all font-mono transition-colors"
            >
              /p/{portal.slug}
            </a>

            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60 text-sm"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>

            <div className="mt-3 flex flex-col gap-2">
              <Link to={`/portals/${portalId}/guests`} className="text-xs text-center text-blue-600 hover:underline">
                Active Devices →
              </Link>
              <Link to={`/portals/${portalId}/analytics`} className="text-xs text-center text-blue-600 hover:underline">
                Guest Analytics →
              </Link>
              {portal.auth_type !== 'click_through' && (
                <Link to={`/portals/${portalId}/vouchers`} className="text-xs text-center text-blue-600 hover:underline">
                  Manage Vouchers →
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
