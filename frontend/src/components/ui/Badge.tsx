import clsx from 'clsx'

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'gray'

const variants: Record<Variant, string> = {
  green: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
  red: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  blue: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
}

export default function Badge({ label, variant = 'gray' }: { label: string; variant?: Variant }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variants[variant])}>
      {label}
    </span>
  )
}
