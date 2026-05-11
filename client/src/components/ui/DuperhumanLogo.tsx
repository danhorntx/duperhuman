import type { CSSProperties } from 'react'

export const DUPERHUMAN_BOLT_PATH = 'M15 1L5 13h5l-1 10 10-12h-5l1-10z'

export function DuperhumanBoltIcon({
  size = 24,
  color = 'currentColor',
  className,
  style,
}: {
  size?: number
  color?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path
        d={DUPERHUMAN_BOLT_PATH}
        fill={color}
        stroke={color}
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DuperhumanLogoMark({
  size = 48,
  iconSize,
  className,
  style,
}: {
  size?: number
  iconSize?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`rounded-2xl flex items-center justify-center ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: 'var(--accent-faint)',
        border: '1px solid var(--border-accent)',
        color: 'var(--accent)',
        ...style,
      }}
    >
      <DuperhumanBoltIcon size={iconSize ?? Math.round(size * 0.46)} />
    </div>
  )
}
