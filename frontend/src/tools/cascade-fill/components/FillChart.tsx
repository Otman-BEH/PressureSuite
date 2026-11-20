import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../format'
import type { TracePoint } from '../types'
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
import { DATA_OTHER, DATA_VESSEL } from '../../../shared/theme'

// The COPV is the vessel colour; its settled pressure is the same colour, dashed. The connected source changes from
// step to step, so it is not one entity and takes the neutral series colour.
const SERIES: Record<'copv' | 'settled' | 'source', SeriesKey> = {
  copv: { key: 'copv', color: DATA_VESSEL, label: 'COPV gas pressure' },
  settled: { key: 'settled', color: DATA_VESSEL, label: 'COPV settled pressure (at ambient)', dash: '5 3' },
  source: { key: 'source', color: DATA_OTHER, label: 'Connected source pressure' },
}
type Key = keyof typeof SERIES

interface Row {
  x: number
  copv: number
  settled: number
  temp: number
  source: number | null
}

function toRows(trace: TracePoint[]): Row[] {
  const rows: Row[] = []
  let prevStep: number | null = null
  for (const p of trace) {
    const row = { x: p.delivered_kg, copv: p.copv_barg, settled: p.copv_settled_barg, temp: p.copv_temp_c, source: p.source_barg }
    // A row without a source value breaks the source line between connections.
    if (prevStep !== null && p.step !== prevStep) rows.push({ ...row, source: null })
    rows.push(row)
    prevStep = p.step
  }
  return rows
}

function TooltipBox({ active, payload, unit }: { active?: boolean; payload?: { payload: Row; dataKey: string; value: number | null }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <ChartTooltip
      header={`${fmt(row.x, 2)} kg delivered`}
      rows={payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => {
          const s = p.dataKey === 'temp' ? { ...SERIES.copv, label: 'COPV gas temperature' } : SERIES[p.dataKey as Key]
          return { key: p.dataKey, label: s.label, color: s.color, dash: s.dash, value: `${fmt(p.value as number)} ${unit}` }
        })}
    />
  )
}

const xAxis = <XAxis type="number" dataKey="x" domain={[0, 'dataMax']} {...axisProps} tickFormatter={(v: number) => fmt(v, 1)} />

export function FillCharts({ trace, targetBarg, ambientC, isothermal }: { trace: TracePoint[]; targetBarg: number; ambientC: number; isothermal: boolean }) {
  const rows = toRows(trace)
  const keys: Key[] = isothermal ? ['copv', 'source'] : ['copv', 'settled', 'source']
  return (
    <div className={`grid gap-6 ${isothermal ? '' : 'xl:grid-cols-2'}`}>
      <ChartFrame yTitle="Pressure · barg" xTitle="Gas delivered · kg" legend={<ChartLegend items={keys.map((k) => SERIES[k])} />}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            {xAxis}
            <YAxis {...yAxisProps} />
            <Tooltip content={<TooltipBox unit="barg" />} cursor={cursorProps} isAnimationActive={false} />
            <ReferenceLine y={targetBarg} {...referenceProps(`Target ${fmt(targetBarg, 0)} barg`)} />
            {keys.map((k) => {
              const s = SERIES[k]
              return <Line key={k} dataKey={k} connectNulls={false} {...lineProps(s.color, k === 'copv' ? 'vessel' : 'series', s.dash)} />
            })}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      {!isothermal && (
        <ChartFrame
          yTitle="COPV gas temperature · °C"
          xTitle="Gas delivered · kg"
          note="Gas temperature only; heating of the composite from strain is not modelled."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid {...gridProps} />
              {xAxis}
              <YAxis {...yAxisProps} />
              <Tooltip content={<TooltipBox unit="°C" />} cursor={cursorProps} isAnimationActive={false} />
              <ReferenceLine y={ambientC} {...referenceProps(`Ambient ${fmt(ambientC)} °C`, 'insideBottomLeft')} />
              <Line dataKey="temp" {...lineProps(DATA_VESSEL, 'vessel')} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </div>
  )
}
