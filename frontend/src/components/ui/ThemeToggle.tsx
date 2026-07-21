import { SunIcon, MoonIcon } from '@heroicons/react/24/outline'
import { useThemeStore } from '../../store/theme'

export default function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className ?? 'text-gray-400 dark:text-gray-500 hover:text-white transition-colors'}
    >
      {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
    </button>
  )
}
