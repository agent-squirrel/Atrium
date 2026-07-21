import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '../api'

export function useDisplaySettings(): { timezone: string; dateFormat: string } {
  const { data } = useQuery({
    queryKey: ['platform_display_settings'],
    queryFn: () => settingsApi.getDisplaySettings().then(r => r.data),
    staleTime: Infinity,
  })
  return {
    timezone: data?.timezone ?? 'UTC',
    dateFormat: data?.date_format ?? 'MM/DD/YYYY',
  }
}
