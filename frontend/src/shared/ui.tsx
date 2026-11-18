import { useEffect, useState, type ReactNode } from 'react'

const roundTo = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits)

interface NumberFieldProps {
  label?: ReactNode
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
  digits?: number
  className?: string
  inputClassName?: string
  title?: string
  /** Short visible explanation under the field. */
  hint?: ReactNode
}

/** Numeric input that lets you type freely and only commits values inside [min, max]. */
export function NumberField({ label, value, onChange, min, max, unit, digits = 2, className = '', inputClassName = '', title, hint }: NumberFieldProps) {
  const [text, setText] = useState(roundTo(value, digits))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(roundTo(value, digits))
  }, [value, editing, digits])

  const parse = (t: string) => {
    const v = Number(t.replace(',', '.'))
    return t.trim() !== '' && Number.isFinite(v) ? v : null
  }
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = () => {
    const v = parse(text)
    const next = v === null ? value : clamp(v)
    if (next !== value) onChange(next)
    setText(roundTo(next, digits))
  }

  return (
    <label className={`flex flex-col gap-1 ${className}`} title={title}>
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <span className="flex items-center rounded-md bg-white ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-sky-500">
        <input
          inputMode="decimal"
          value={text}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            const v = parse(e.target.value)
            if (v !== null && v === clamp(v)) onChange(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className={`w-full min-w-0 bg-transparent px-2 py-1 text-sm tabular-nums text-slate-900 outline-none ${inputClassName}`}
        />
        {unit && <span className="pr-2 text-xs whitespace-nowrap text-slate-500">{unit}</span>}
      </span>
      {hint && <span className="text-[11px] leading-snug text-slate-500">{hint}</span>}
    </label>
  )
}

/** Like NumberField, but may be left blank (null), e.g. for a reading that was not taken. */
export function OptionalNumberField({ label, value, onChange, min, max, unit, digits = 2, className = '', placeholder = '–', title }: Omit<NumberFieldProps, 'value' | 'onChange'> & {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  const show = (v: number | null) => (v === null ? '' : roundTo(v, digits))
  const [text, setText] = useState(show(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(show(value))
  }, [value, editing, digits])
  const parse = (t: string): number | null | undefined => {
    if (t.trim() === '') return null
    const v = Number(t.replace(',', '.'))
    return Number.isFinite(v) ? v : undefined // undefined: not a number, keep the old value
  }
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const commit = () => {
    const v = parse(text)
    const next = v === undefined ? value : v === null ? null : clamp(v)
    if (next !== value) onChange(next)
    setText(show(next))
  }
  return (
    <label className={`flex flex-col gap-1 ${className}`} title={title}>
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <span className="flex items-center rounded-md bg-white ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-sky-500">
        <input
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            const v = parse(e.target.value)
            if (v === null || (v !== undefined && v === clamp(v))) onChange(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-sm tabular-nums text-slate-900 outline-none placeholder:text-slate-400"
        />
        {unit && <span className="pr-2 text-xs whitespace-nowrap text-slate-500">{unit}</span>}
      </span>
    </label>
  )
}

interface SelectFieldProps<T extends string> {
  label?: ReactNode
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}

export function SelectField<T extends string>({ label, value, options, onChange, className = '' }: SelectFieldProps<T>) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md bg-white px-2 py-1 text-sm text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-sky-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  label?: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
            o.value === value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** − ×n + : how many identical units something stands for. */
export function Stepper({ value, onChange, min = 1, max = 100, title, className = '' }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  title: string
  className?: string
}) {
  const btn = 'grid w-5 place-items-center text-slate-500 hover:text-sky-700 disabled:opacity-30 disabled:hover:text-slate-500'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md bg-white ring-1 ring-slate-200 ${className}`} title={title}>
      <button type="button" aria-label="One fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>
        −
      </button>
      <span className="min-w-6 text-center text-[11px] font-semibold text-slate-800 tabular-nums">×{value}</span>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>
        +
      </button>
    </span>
  )
}

export function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>
      {children}
    </span>
  )
}

export function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * A titled card. With `onToggle` the title folds the body away; `collapsedAside` replaces `aside` while folded (e.g. a
 * one-line result).
 */
export function Panel({ title, aside, children, className = '', collapsed = false, onToggle, collapsedAside }: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  collapsed?: boolean
  onToggle?: () => void
  collapsedAside?: ReactNode
}) {
  return (
    <section className={`rounded-xl bg-white ring-1 ring-slate-200 ${className}`}>
      <header className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${collapsed ? '' : 'border-b border-slate-100'}`}>
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-sky-700">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`size-4 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}>
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
            {title}
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        )}
        {collapsed ? collapsedAside : aside}
      </header>
      {!collapsed && <div className="p-4">{children}</div>}
    </section>
  )
}

/** Small secondary button, for tool-level actions and links between tools. */
export function LinkButton({ onClick, children, title, disabled = false }: { onClick: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-slate-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

/** One labelled result value. */
export function Stat({ label, value, sub, strong = false }: { label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-xl font-semibold text-slate-900' : 'text-sm font-semibold text-slate-800'}`}>{value}</span>
      {sub && <span className="text-[11px] text-slate-500 tabular-nums">{sub}</span>}
    </div>
  )
}

/**
 * A note from the API: "critical" is for things people must know (mostly safety), shown in red; "note" is worth acting
 * on, shown in yellow; "assumption" is a standing modelling assumption, listed in `Assumptions`.
 */
export interface Note {
  level: 'note' | 'critical' | 'assumption'
  text: string
}

function WarningIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`mt-px size-4 shrink-0 ${className}`}>
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

const TONES = {
  red: { box: 'bg-rose-50 text-rose-800 ring-rose-200 font-medium', icon: 'text-rose-600' },
  yellow: { box: 'bg-amber-50 text-amber-900 ring-amber-200', icon: 'text-amber-500' },
}

function Callout({ children, tone }: { children: ReactNode; tone: keyof typeof TONES }) {
  const t = TONES[tone]
  return (
    <p role={tone === 'red' ? 'alert' : 'note'} className={`flex items-start gap-2 rounded-md px-3 py-2 ring-1 ${t.box}`}>
      <WarningIcon className={t.icon} />
      <span>{children}</span>
    </p>
  )
}

/**
 * Errors and notes under a result: errors and critical notes in red, other notes in yellow, critical ones first.
 * Assumptions are left out (show them with `Assumptions`), unless `withAssumptions` folds them in at the end.
 */
export function Notes({ error, notes, withAssumptions = false }: { error?: string | null; notes?: (Note | string)[]; withAssumptions?: boolean }) {
  const all = (notes ?? []).map((n) => (typeof n === 'string' ? { level: 'note' as const, text: n } : n))
  const list = all.filter((n) => n.level !== 'assumption')
  const assumed = withAssumptions ? all.filter((n) => n.level === 'assumption') : []
  if (!error && !list.length && assumed.length) return <Assumptions notes={assumed} />
  if (!error && !list.length) return null
  const sorted = [...list.filter((n) => n.level === 'critical'), ...list.filter((n) => n.level !== 'critical')]
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {error && <Callout tone="red">{error}</Callout>}
      {sorted.map((n) => (
        <Callout key={n.text} tone={n.level === 'critical' ? 'red' : 'yellow'}>
          {n.text}
        </Callout>
      ))}
      {assumed.length > 0 && <Assumptions notes={assumed} />}
    </div>
  )
}

/** Standing modelling assumptions, folded away under one line. */
export function Assumptions({ notes }: { notes?: Note[] }) {
  const list = (notes ?? []).filter((n) => n.level === 'assumption')
  if (!list.length) return null
  return (
    <details className="text-[11px] text-slate-500">
      <summary className="cursor-pointer select-none hover:text-slate-700">Assumptions ({list.length})</summary>
      <ul className="mt-1 ml-4 list-disc space-y-0.5">
        {list.map((n) => (
          <li key={n.text}>{n.text}</li>
        ))}
      </ul>
    </details>
  )
}

export function Toggle({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-sky-600" />
      {label}
    </label>
  )
}
