interface Props {
  variant?: 'white' | 'navy'
  className?: string
}

export default function AtriumLogo({ variant = 'white', className = 'h-8' }: Props) {
  const fill = variant === 'white' ? '#ffffff' : '#1e3a5f'
  const bg = variant === 'white' ? 'none' : '#1e3a5f'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 380 120"
      className={className}
      aria-label="Atrium"
      role="img"
    >
      {variant === 'navy' && (
        <rect x="10" y="10" width="100" height="100" rx="20" fill={bg} />
      )}
      <polygon
        points="60,27 93,60 60,93 27,60"
        fill="none"
        stroke={fill}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <line x1="60" y1="27" x2="60" y2="93" stroke={fill} strokeWidth="5" />
      <line x1="27" y1="60" x2="93" y2="60" stroke={fill} strokeWidth="5" />
      <text
        x="130"
        y="78"
        fontFamily="DejaVu Sans, Arial, Helvetica, sans-serif"
        fontSize="58"
        fontWeight="700"
        letterSpacing="1"
        fill={fill}
      >
        Atrium
      </text>
    </svg>
  )
}
