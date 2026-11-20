import type { ReactNode } from 'react'
import { COLOR } from './theme'
import { LABEL } from './ui'

/**
 * The one chart theme (DESIGN.md, "Charts"). Every Recharts chart spreads these props and uses ChartFrame,
 * ChartLegend and ChartTooltip, so grids, ticks, lines, legends and tooltips look the same on every tab.
 */

const MONO = 'IBM Plex Mono, monospace'

export const CHART_MARGIN = { top: 8, right: 16, bottom: 4, left: 0 }

/** Horizontal hairlines only. */
export const gridProps = { stroke: COLOR.rule, strokeWidth: 1, vertical: false } as const

/** Mono tick labels, no tick marks, axis line in the strong rule colour. Units go in the axis title, not the ticks. */
export const axisProps = {
  tick: { fill: COLOR.muted, fontSize: 11, fontFamily: MONO },
  tickLine: false,
  axisLine: { stroke: COLOR.ruleStrong },
  tickMargin: 4,
} as const

export const yAxisProps = { ...axisProps, width: 44 } as const

/** Crosshair line under the tooltip. */
export const cursorProps = { stroke: COLOR.ruleStrong, strokeWidth: 1 } as const

/** Line marks: 2px for the vessel under test, 1.5px for everything else; no dots, no animation. */
export function lineProps(color: string, weight: 'vessel' | 'series' = 'series', dash?: string) {
  return {
    type: 'linear' as const,
    stroke: color,
    strokeWidth: weight === 'vessel' ? 2 : 1.5,
    strokeDasharray: dash,
    strokeLinejoin: 'round' as const,
    dot: false as const,
    activeDot: { r: 4, fill: color, stroke: COLOR.surface, strokeWidth: 2 },
    isAnimationActive: false,
  }
}

/** Target and limit lines: dashed strong rule with a mono label. */
export function referenceProps(label: string, position: 'insideTopLeft' | 'insideBottomLeft' = 'insideTopLeft') {
  return {
    stroke: COLOR.ruleStrong,
    strokeWidth: 1,
    strokeDasharray: '4 3',
    ifOverflow: 'extendDomain' as const,
    label: { value: label, position, fill: COLOR.ink, fontSize: 11, fontFamily: MONO },
  }
}

export interface SeriesKey {
  key: string
  label: string
  color: string
  dash?: string
}

/** A 14×2px line swatch in the series colour, dashed like its line when the line is. */
export function Swatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 2" className="h-0.5 w-3.5 shrink-0">
      <line x1="0" y1="1" x2="14" y2="1" stroke={color} strokeWidth="2" strokeDasharray={dash ? '3 2' : undefined} />
    </svg>
  )
}

/**
 * Legend above the plot. With `visible` and `onToggle`, each entry is a button that shows or hides its series; a
 * hidden series keeps its colour when it comes back (colour follows the entity).
 */
export function ChartLegend({ items, visible, onToggle }: { items: SeriesKey[]; visible?: (key: string) => boolean; onToggle?: (key: string) => void }) {
  if (items.length < 2 && !onToggle) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1" role={onToggle ? 'group' : undefined} aria-label={onToggle ? 'Show or hide series' : undefined}>
      {items.map((s) => {
        const on = visible ? visible(s.key) : true
        const body = (
          <>
            <Swatch color={on ? s.color : COLOR.rule} dash={s.dash} />
            {s.label}
          </>
        )
        return onToggle ? (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s.key)}
            className={`flex items-center gap-1.5 text-small ${on ? 'text-ink' : 'text-muted line-through'} hover:text-ink`}
          >
            {body}
          </button>
        ) : (
          <span key={s.key} className="flex items-center gap-1.5 text-small text-ink">
            {body}
          </span>
        )
      })}
    </div>
  )
}

/** A chart with its axis titles in the label style: y title above the plot, x title under it at the right. */
export function ChartFrame({ yTitle, xTitle, legend, note, height = 240, children }: {
  yTitle: string
  xTitle: string
  legend?: ReactNode
  note?: ReactNode
  height?: number
  children: ReactNode
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      {legend}
      <figcaption className={LABEL}>{yTitle}</figcaption>
      <div style={{ height }}>{children}</div>
      <div className={`text-right ${LABEL}`}>{xTitle}</div>
      {note && <p className="text-small text-muted">{note}</p>}
    </figure>
  )
}

export interface TooltipRow {
  key: string
  label: string
  value: string
  color?: string
  dash?: string
}

/** Tooltip box: surface, strong-rule border, no radius or shadow; header in the label style, values mono. */
export function ChartTooltip({ header, rows, footer }: { header: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-40 border border-rule-strong bg-surface px-2 py-1.5 text-small">
      <div className={`mb-1 ${LABEL}`}>{header}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          {r.color && <Swatch color={r.color} dash={r.dash} />}
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto pl-3 font-mono font-medium text-ink">{r.value}</span>
        </div>
      ))}
      {footer}
    </div>
  )
}
