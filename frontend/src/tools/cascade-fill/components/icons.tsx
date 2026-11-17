type IconProps = { className?: string }

export function BottleIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 40" className={className} aria-hidden="true">
      <rect x="9" y="1" width="6" height="5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="4" y="6" width="16" height="32" rx="7" fill="currentColor" />
      <rect x="7" y="11" width="3" height="20" rx="1.5" fill="white" opacity="0.35" />
    </svg>
  )
}

export function BundleIcon({ className = '' }: IconProps) {
  const cells = []
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) cells.push(<rect key={`${r}-${c}`} x={5 + c * 8} y={5 + r * 10} width="6" height="9" rx="3" fill="currentColor" />)
  return (
    <svg viewBox="0 0 42 40" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="39" height="37" rx="4" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      {cells}
    </svg>
  )
}

export function CooldownIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11" />
      <path d="M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5" />
    </svg>
  )
}

/** P&ID-style pump: circle with a discharge triangle. */
export function BoosterIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 7.5L17 12l-8.5 4.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** P&ID-style compressor: circle with converging lines. */
export function CompressorIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M5 6.5l14 3M5 17.5l14-3" />
    </svg>
  )
}

/** P&ID-style heat exchanger: circle with a coil through it. */
export function HeatExchangerIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h3l2-4 3 8 3-8 3 8 2-4h2" />
    </svg>
  )
}

/** Distribution manifold: one inlet, a header, several outlets. */
export function ManifoldIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 12h5M7 5v14M7 5h6M7 12h6M7 19h6" />
      <circle cx="16" cy="5" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="16" cy="19" r="2" />
    </svg>
  )
}

export function ClockIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function ArrowRight({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

export function XIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function PencilIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </svg>
  )
}

export function TrashIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  )
}

export function PlusIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function GripIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
    </svg>
  )
}
