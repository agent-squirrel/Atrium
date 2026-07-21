interface Props {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, action }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
        {subtitle && <p className="text-gray-500 dark:text-gray-400 mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
