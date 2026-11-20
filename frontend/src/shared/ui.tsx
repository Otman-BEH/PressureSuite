import { useEffect, useState, type ReactNode } from 'react'

/*
 * Shared primitives. Every style here follows DESIGN.md; tools compose these rather than restyling them.
 */

const roundTo = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits)

/** Uppercase, letter-spaced, muted: panel titles, field labels, table headers, readout labels. */
export const LABEL = 'text-label font-medium uppercase text-muted'

/** Table cell styles: header in the label style, figures mono and right-aligned, hairline row rules on the tbody. */
export const TH = `px-2 py-1.5 text-left align-bottom whitespace-nowrap ${LABEL}`
export const TD = 'px-2 py-1.5 text-right font-mono text-small whitespace-nowrap'
export const THEAD = 'border-b border-rule-strong'
export const TBODY = 'divide-y divide-rule'
export const TFOOT = 'border-t border-rule-strong font-semibold'

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={LABEL}>{children}</span>
}

/** The input well: inset, hairline border that turns into a 2px accent ring on focus. */
const WELL =
  'flex h-7 items-center rounded-control border border-rule-strong bg-inset focus-within:border-accent focus-within:ring-1 focus-within:ring-accent'
const INPUT = 'h-full w-full min-w-0 bg-transparent px-2 font-mono text-body text-ink outline-none placeholder:text-muted'

/** Unit set right-aligned at the end of the well, so units line up down a column of equal-width fields. */
function Unit({ children }: { children: ReactNode }) {
  return <span className="shrink-0 pr-2 pl-1 text-right font-mono text-small whitespace-nowrap text-muted">{children}</span>
}

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
  /** Short visible note under the field, only for what the label cannot say (e.g. "= 301 bar a"). */
  hint?: ReactNode
  /** Right-align the value, for fields in a table column. */
  alignRight?: boolean
}

/** Numeric input that lets you type freely and only commits values inside [min, max]. */
export function NumberField({ label, value, onChange, min, max, unit, digits = 2, className = '', inputClassName = '', title, hint, alignRight = false }: NumberFieldProps) {
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
    <label className={`flex flex-col justify-end gap-1 ${className}`} title={title}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <span className={WELL}>
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
          className={`${INPUT} ${alignRight ? 'text-right' : ''} ${inputClassName}`}
        />
        {unit && <Unit>{unit}</Unit>}
      </span>
      {hint && <span className="text-small text-muted">{hint}</span>}
    </label>
  )
}

/** Like NumberField, but may be left blank (null), e.g. for a reading that was not taken. */
export function OptionalNumberField({ label, value, onChange, min, max, unit, digits = 2, className = '', placeholder = '–', title, alignRight = false }: Omit<NumberFieldProps, 'value' | 'onChange'> & {
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
    <label className={`flex flex-col justify-end gap-1 ${className}`} title={title}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <span className={WELL}>
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
          className={`${INPUT} ${alignRight ? 'text-right' : ''}`}
        />
        {unit && <Unit>{unit}</Unit>}
      </span>
    </label>
  )
}

/** Free text in the same well, e.g. a source name. */
export function TextField({ label, value, onChange, className = '' }: { label?: ReactNode; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`flex flex-col justify-end gap-1 ${className}`}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <span className={WELL}>
        <input value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} font-sans`} />
      </span>
    </label>
  )
}

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`size-4 shrink-0 ${className}`}>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  )
}

interface SelectFieldProps<T extends string> {
  label?: ReactNode
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  className?: string
}

export function SelectField<T extends string>({ label, value, options, onChange, className = '' }: SelectFieldProps<T>) {
  return (
    <label className={`flex flex-col justify-end gap-1 ${className}`}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <span className={`${WELL} relative`}>
        <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${INPUT} cursor-pointer appearance-none pr-7 font-sans`}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Chevron className="pointer-events-none absolute right-1.5 text-muted" />
      </span>
    </label>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  label?: string
}

/** Joined, squared buttons; the active one is set on the inset colour with an accent bar along its bottom. */
export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 overflow-hidden rounded-control border border-rule-strong bg-surface">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative border-l border-rule px-3 text-body whitespace-nowrap first:border-l-0 focus-visible:-outline-offset-2 ${
              on ? 'bg-inset font-semibold text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
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
  const btn = 'grid h-full w-5 place-items-center text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted'
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-control border border-rule-strong bg-inset ${className}`} title={title}>
      <button type="button" aria-label="One fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>
        −
      </button>
      <span className="min-w-6 text-center font-mono text-small font-medium text-ink">×{value}</span>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>
        +
      </button>
    </span>
  )
}

export type LampStatus = 'ok' | 'warn' | 'crit' | 'idle'

const LAMP: Record<LampStatus, { mark: string; text: string }> = {
  ok: { mark: 'bg-ok', text: 'text-ink' },
  warn: { mark: 'bg-warn', text: 'text-warn-ink' },
  crit: { mark: 'bg-crit', text: 'text-crit-ink' },
  idle: { mark: 'bg-rule-strong', text: 'text-muted' },
}

/** Status lamp: a small square in the status colour, then text that names the state (never colour alone). */
export function Lamp({ status, children, title, className = '' }: { status: LampStatus; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-small whitespace-nowrap ${LAMP[status].text} ${className}`} title={title}>
      <span className={`size-2 shrink-0 ${LAMP[status].mark}`} aria-hidden="true" />
      {children}
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'quiet'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover',
  secondary: 'border-rule-strong bg-surface text-ink hover:bg-inset',
  quiet: 'border-transparent text-accent hover:bg-accent-tint',
}

/** The three button styles: one solid primary per region, outlined secondary, text-only quiet. */
export function Button({ variant = 'secondary', onClick, children, title, disabled = false, className = '', type = 'button' }: {
  variant?: ButtonVariant
  onClick?: () => void
  children: ReactNode
  title?: string
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-control border px-2.5 text-body font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:border-rule disabled:bg-bg disabled:text-muted ${BUTTON[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Secondary button, kept under its old name for links between tools ("Stored energy details →"). */
export function LinkButton(props: { onClick: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return <Button variant="secondary" {...props} />
}

export function IconButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`grid size-6 shrink-0 place-items-center rounded-control text-muted hover:bg-bg hover:text-ink ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * A flat section: uppercase label header over a hairline rule. With `onToggle` the title folds the body away;
 * `collapsedAside` replaces `aside` while folded (e.g. a one-line result).
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
    <section className={`border-b border-rule bg-surface ${className}`}>
      <header className={`flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1 ${collapsed ? '' : 'border-b border-rule'}`}>
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-expanded={!collapsed} className={`flex items-center gap-1 hover:text-ink ${LABEL}`}>
            <Chevron className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
            {title}
          </button>
        ) : (
          <h2 className={LABEL}>{title}</h2>
        )}
        {collapsed ? collapsedAside : aside}
      </header>
      {!collapsed && <div className="p-3">{children}</div>}
    </section>
  )
}

/**
 * One labelled result: uppercase label, mono value with its unit set smaller beside it, optional status lamp and
 * sub-line. `size="lg"` is for key results, which are the biggest thing on screen.
 */
export function Readout({ label, value, unit, sub, status, size = 'md', title }: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  sub?: ReactNode
  status?: { level: LampStatus; text: ReactNode }
  size?: 'lg' | 'md'
  title?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className={LABEL}>{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-1">
        <span className={`font-mono font-medium text-ink ${size === 'lg' ? 'text-readout' : 'text-readout-sm'}`}>{value}</span>
        {unit && <span className="font-mono text-small text-muted">{unit}</span>}
      </span>
      {status && <Lamp status={status.level}>{status.text}</Lamp>}
      {sub && <span className="text-small text-muted">{sub}</span>}
    </div>
  )
}

/**
 * A row of readouts separated by hairline rules. Every readout carries a left rule; the wrapper clips the ones in the
 * first column, so the rules stay correct however the row wraps.
 */
export function ReadoutRow({ children, className = 'sm:grid-cols-4' }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-hidden">
      <div className={`-ml-3 grid grid-cols-2 gap-y-3 [&>*]:border-l [&>*]:border-rule [&>*]:px-3 ${className}`}>{children}</div>
    </div>
  )
}

/**
 * A note from the API: "critical" is for things people must know (mostly safety), shown in red; "note" is worth acting
 * on, shown in amber; "assumption" is a standing modelling assumption, listed in `Assumptions`.
 */
export interface Note {
  level: 'note' | 'critical' | 'assumption'
  text: string
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-px size-4 shrink-0 text-crit">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

const TONES = {
  crit: 'border-crit bg-crit-tint text-crit-ink font-medium',
  warn: 'border-warn bg-warn-tint text-warn-ink',
}

/** Left status bar on a tinted block; critical ones carry a warning glyph and role="alert". */
export function Callout({ children, tone }: { children: ReactNode; tone: keyof typeof TONES }) {
  return (
    <p role={tone === 'crit' ? 'alert' : 'note'} className={`flex items-start gap-2 border-l-[3px] px-3 py-2 text-small ${TONES[tone]}`}>
      {tone === 'crit' && <WarningIcon />}
      <span>{children}</span>
    </p>
  )
}

/**
 * Errors and notes under a result: errors and critical notes in red, other notes in amber, critical ones first.
 * Assumptions are left out (show them with `Assumptions`), unless `withAssumptions` folds them in at the end.
 */
export function Notes({ error, notes, withAssumptions = false, className = '' }: {
  error?: string | null
  notes?: (Note | string)[]
  withAssumptions?: boolean
  /** Spacing around the block when it sits loose in a column (nothing is rendered when there is nothing to say). */
  className?: string
}) {
  const all = (notes ?? []).map((n) => (typeof n === 'string' ? { level: 'note' as const, text: n } : n))
  const list = all.filter((n) => n.level !== 'assumption')
  const assumed = withAssumptions ? all.filter((n) => n.level === 'assumption') : []
  if (!error && !list.length && assumed.length) return <Assumptions notes={assumed} className={className} />
  if (!error && !list.length) return null
  const sorted = [...list.filter((n) => n.level === 'critical'), ...list.filter((n) => n.level !== 'critical')]
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {error && <Callout tone="crit">{error}</Callout>}
      {sorted.map((n) => (
        <Callout key={n.text} tone={n.level === 'critical' ? 'crit' : 'warn'}>
          {n.text}
        </Callout>
      ))}
      {assumed.length > 0 && <Assumptions notes={assumed} />}
    </div>
  )
}

/** Standing modelling assumptions, folded away under one line. */
export function Assumptions({ notes, className = '' }: { notes?: Note[]; className?: string }) {
  const list = (notes ?? []).filter((n) => n.level === 'assumption')
  if (!list.length) return null
  return (
    <details className={`text-small text-muted ${className}`}>
      <summary className={`cursor-pointer select-none hover:text-ink ${LABEL}`}>Assumptions ({list.length})</summary>
      <ul className="mt-1 ml-4 list-disc space-y-0.5">
        {list.map((n) => (
          <li key={n.text}>{n.text}</li>
        ))}
      </ul>
    </details>
  )
}

export function Toggle({ label, checked, onChange, title }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="flex items-center gap-2 text-body text-ink" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5" />
      {label}
    </label>
  )
}

/** On/off switch for hardware that is in or out of the line: square track and knob. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-control transition-colors ${checked ? 'bg-accent' : 'bg-rule-strong'}`}
    >
      <span className={`inline-block size-3 bg-inset transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
    </button>
  )
}
