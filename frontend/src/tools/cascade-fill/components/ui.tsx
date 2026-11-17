import { useEffect, useState, type ReactNode } from 'react'
import { FLUIDS } from '../format'
import type { Fluid } from '../types'

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
}

/** Numeric input that lets you type freely and only commits values inside [min, max]. */
export function NumberField({ label, value, onChange, min, max, unit, digits = 2, className = '', inputClassName = '', title }: NumberFieldProps) {
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

export function FluidChip({ fluid }: { fluid: Fluid }) {
  return (
    <Chip className={FLUIDS[fluid].chip}>
      <span className={`size-1.5 rounded-full ${FLUIDS[fluid].dot}`} />
      {FLUIDS[fluid].short}
    </Chip>
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

export function Panel({ title, aside, children, className = '' }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white ring-1 ring-slate-200 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
