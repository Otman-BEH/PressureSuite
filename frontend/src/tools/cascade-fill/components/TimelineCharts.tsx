import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtMin, sourceName } from '../format'
import type { Source, TimelinePoint } from '../types'

// Reference categorical palette in fixed order: slot 1 is always the COPV, then the inventory order.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OVERFLOW = '#898781' // past eight series: muted, still listed in the legend
const INK = { muted: '#898781', secondary: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7' }

interface Series {
  key: string
  label: string
  color: string
}

type Row = { x: number; phase: string; copvT: number } & Record<string, number | string>

const axisProps = { tick: { fill: INK.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: INK.axis } } as const

function xLabel(v: number, timed: boolean) {
  if (!timed) return `${fmt(v, 0)}`
  return v < 120 ? `${fmt(v, 0)} min` : `${fmt(v / 60, 1)} h`
}

function TooltipBox({ active, payload, series, timed, unit }: {
  active?: boolean
  payload?: { payload: Row; dataKey: string; value: number; color: string }[]
  series: Series[]
  timed: boolean
  unit: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const labels = new Map(series.map((s) => [s.key, s.label]))
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <div className="mb-1 font-medium text-slate-500">
        {row.phase}
        {timed && <span className="tabular-nums"> · {fmtMin(row.x)}</span>}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-slate-800 tabular-nums">
          <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          <span className="text-slate-500">{p.dataKey === 'copvT' ? 'COPV gas' : labels.get(p.dataKey)}</span>
          <span className="ml-auto pl-3 font-semibold">
            {fmt(p.value)} {unit}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Pressure of every vessel (show/hide per vessel) and the COPV gas temperature along the whole cycle. */
export function TimelineCharts({ timeline, sources, targetBarg, ambientC, isothermal }: {
  timeline: TimelinePoint[]
  sources: Source[]
  targetBarg: number
  ambientC: number
  isothermal: boolean
}) {
  const [shown, setShown] = useState<Record<string, boolean>>({})
  if (!timeline?.length) return <p className="text-xs text-slate-500">No timeline in this result. Restart the backend if it is an older version.</p>
  const timed = timeline[0].t_min !== null
  const ids = Object.keys(timeline[0]?.vessels ?? {})
  const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
  const series: Series[] = [
    { key: 'copv', label: 'COPV', color: PALETTE[0] },
    ...sources.filter((s) => ids.includes(s.id)).map((s, i) => ({ key: s.id, label: labels.get(s.id) ?? s.id, color: PALETTE[i + 1] ?? OVERFLOW })),
  ]
  // By default show the COPV and the vessels whose pressure changes.
  const changes = (key: string) => {
    const values = timeline.map((p) => (key === 'copv' ? p.copv_barg : p.vessels[key]))
    return Math.max(...values) - Math.min(...values) > 0.05
  }
  const visible = (key: string) => shown[key] ?? (key === 'copv' || changes(key))
  const rows: Row[] = timeline.map((p) => ({ x: timed ? (p.t_min ?? 0) : p.progress, phase: p.phase, copv: p.copv_barg, copvT: p.copv_temp_c, ...p.vessels }))
  const xAxis = (
    <XAxis
      type="number"
      dataKey="x"
      domain={[0, 'dataMax']}
      allowDecimals={timed}
      {...axisProps}
      tickFormatter={(v: number) => xLabel(v, timed)}
      label={timed ? undefined : { value: 'step', position: 'insideBottomRight', offset: -2, fill: INK.muted, fontSize: 11 }}
    />
  )

  return (
    <div className={`grid gap-4 ${isothermal ? '' : 'xl:grid-cols-2'}`}>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-semibold text-slate-700">Pressures {timed ? 'over time' : 'step by step'} (barg)</figcaption>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show or hide vessels">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={visible(s.key)}
              onClick={() => setShown({ ...shown, [s.key]: !visible(s.key) })}
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ring-1 transition-colors ${
                visible(s.key) ? 'bg-white text-slate-700 ring-slate-300' : 'bg-slate-50 text-slate-400 ring-slate-200'
              }`}
            >
              <span className="h-0.5 w-4 rounded" style={{ background: visible(s.key) ? s.color : INK.axis }} />
              {s.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            {xAxis}
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<TooltipBox series={series} timed={timed} unit="barg" />} cursor={{ stroke: INK.axis }} isAnimationActive={false} />
            {visible('copv') && (
              <ReferenceLine
                y={targetBarg}
                stroke={INK.secondary}
                strokeWidth={1}
                label={{ value: `COPV target ${fmt(targetBarg, 0)} barg`, position: 'insideTopLeft', fill: INK.secondary, fontSize: 11 }}
              />
            )}
            {series.filter((s) => visible(s.key)).map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: '#fcfcfb', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </figure>
      {!isothermal && (
        <figure className="flex flex-col gap-2">
          <figcaption className="text-xs font-semibold text-slate-700">COPV gas temperature {timed ? 'over time' : 'step by step'} (°C)</figcaption>
          <div className="text-[11px] text-slate-500">
            Fill, settling{timed ? ', hold' : ''} and venting/recovery. Gas temperature only; strain heating of the composite is not modelled.
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              {xAxis}
              <YAxis {...axisProps} width={44} />
              <Tooltip content={<TooltipBox series={series} timed={timed} unit="°C" />} cursor={{ stroke: INK.axis }} isAnimationActive={false} />
              <ReferenceLine
                y={ambientC}
                stroke={INK.secondary}
                strokeWidth={1}
                label={{ value: `Ambient ${fmt(ambientC)} °C`, position: 'insideBottomLeft', fill: INK.secondary, fontSize: 11 }}
              />
              <Line
                dataKey="copvT"
                stroke={PALETTE[0]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: '#fcfcfb', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      )}
    </div>
  )
}
