export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const
export type DateFormat = typeof DATE_FORMATS[number]

// Intl.DateTimeFormat's day/month/year order is locale-driven, not
// controllable via options - anchoring each preset to a locale known to
// produce that exact order is the simplest reliable way to force it.
const LOCALE_BY_FORMAT: Record<DateFormat, string> = {
  'MM/DD/YYYY': 'en-US',
  'DD/MM/YYYY': 'en-GB',
  'YYYY-MM-DD': 'sv-SE',
}

function localeFor(dateFormat: string): string {
  return LOCALE_BY_FORMAT[dateFormat as DateFormat] ?? 'en-US'
}

export function formatDateTime(iso: string, timeZone: string, dateFormat: string): string {
  return new Date(iso).toLocaleString(localeFor(dateFormat), { timeZone })
}

export function formatDate(iso: string, timeZone: string, dateFormat: string): string {
  return new Date(iso).toLocaleDateString(localeFor(dateFormat), { timeZone })
}
