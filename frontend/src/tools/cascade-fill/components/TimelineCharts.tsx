import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtMin, sourceName } from '../format'
import type { Source, TimelinePoint } from '../types'
import {
  axisProps,
  CHART_MARGIN,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  cursorProps,
  gridProps,
  lineProps,
  referenceProps,
  yAxisProps,
  type SeriesKey,
} from '../../../shared/chartTheme'
import { DATA_VESSEL, sourceColor } from '../../../shared/theme'

// The COPV is always the vessel colour; each source keeps the colour of its place in the inventory (DESIGN.md).

type Row = { x: number; phase: string; copvT: number } & Record<string, number | string>

function TooltipBox({ active, payload, series, timed, unit }: {
  active?: boolean
  payload?: { payload: Row; dataKey: string; value: number }[]
  series: SeriesKey[]
  timed: boolean
  unit: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const byKey = new Map(series.map((s) => [s.key, s]))
  return (
    <ChartTooltip
      header={
        <>
          {row.phase}
          {timed && ` · ${fmtMin(row.x)}`}
        </>
      }
      rows={payload.map((p) => {
        const s = p.dataKey === 'copvT' ? { key: 'copvT', label: 'COPV gas', color: DATA_VESSEL } : byKey.get(p.dataKey)
        return { key: p.dataKey, label: s?.label ?? p.dataKey, color: s?.color, value: `${fmt(p.value)} ${unit}` }
      })}
    />
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
  if (!timeline?.length) return <p className="text-small text-muted">No timeline in this result. Restart the backend if it is an older version.</p>
  const timed = timeline[0].t_min !== null
  const ids = Object.keys(timeline[0]?.vessels ?? {})
  const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
  const series: SeriesKey[] = [
    { key: 'copv', label: 'COPV', color: DATA_VESSEL },
    ...sources.flatMap((s, i) => (ids.includes(s.id) ? [{ key: s.id, label: labels.get(s.id) ?? s.id, color: sourceColor(i) }] : [])),
  ]
  // By default show the COPV and the vessels whose pressure changes.
  const changes = (key: string) => {
    const values = timeline.map((p) => (key === 'copv' ? p.copv_barg : p.vessels[key]))
    return Math.max(...values) - Math.min(...values) > 0.05
  }
  const visible = (key: string) => shown[key] ?? (key === 'copv' || changes(key))
  const rows: Row[] = timeline.map((p) => ({ x: timed ? (p.t_min ?? 0) : p.progress, phase: p.phase, copv: p.copv_barg, copvT: p.copv_temp_c, ...p.vessels }))
  const xTitle = timed ? 'Time · min' : 'Step'
  const xAxis = <XAxis type="number" dataKey="x" domain={[0, 'dataMax']} allowDecimals={timed} {...axisProps} tickFormatter={(v: number) => fmt(v, 0)} />

  return (
    <div className={`grid gap-6 ${isothermal ? '' : 'xl:grid-cols-2'}`}>
      <ChartFrame
        height={260}
        yTitle="Pressure · barg"
        xTitle={xTitle}
        legend={<ChartLegend items={series} visible={visible} onToggle={(key) => setShown({ ...shown, [key]: !visible(key) })} />}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis {...yAxisProps} />
            <Tooltip content={<TooltipBox series={series} timed={timed} unit="barg" />} cursor={cursorProps} isAnimationActive={false} />
            {visible('copv') && <ReferenceLine y={targetBarg} {...referenceProps(`COPV target ${fmt(targetBarg, 0)} barg`)} />}
            {series
              .filter((s) => visible(s.key))
              .map((s) => (
                <Line key={s.key} dataKey={s.key} {...lineProps(s.color, s.key === 'copv' ? 'vessel' : 'series')} />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      {!isothermal && (
        <ChartFrame
          height={260}
          yTitle="COPV gas temperature · °C"
          xTitle={xTitle}
          note={`Fill, settling${timed ? ', hold' : ''} and venting/recovery. Gas temperature only; strain heating of the composite is not modelled.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid {...gridProps} />
              {xAxis}
              <YAxis {...yAxisProps} />
              <Tooltip content={<TooltipBox series={series} timed={timed} unit="°C" />} cursor={cursorProps} isAnimationActive={false} />
              <ReferenceLine y={ambientC} {...referenceProps(`Ambient ${fmt(ambientC)} °C`, 'insideBottomLeft')} />
              <Line dataKey="copvT" {...lineProps(DATA_VESSEL, 'vessel')} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </div>
  )
}
