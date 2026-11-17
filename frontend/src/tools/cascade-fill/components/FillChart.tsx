import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../format'
import type { TracePoint } from '../types'

// Reference categorical palette, slots 1-3 in fixed order (validated all-pairs).
const SERIES = {
  copv: { color: '#2a78d6', label: 'COPV gas pressure' },
  settled: { color: '#eb6834', label: 'COPV settled pressure (at ambient)' },
  source: { color: '#1baf7a', label: 'Connected source pressure' },
} as const
const INK = { muted: '#898781', secondary: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7' }

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

const axisProps = {
  tick: { fill: INK.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: INK.axis },
} as const

function TooltipBox({ active, payload, unit }: { active?: boolean; payload?: { payload: Row; dataKey: string; value: number | null; color: string }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <div className="mb-1 font-medium text-slate-500 tabular-nums">{fmt(row.x, 2)} kg delivered</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-slate-800 tabular-nums">
            <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
            <span className="text-slate-500">{p.dataKey === 'temp' ? 'COPV gas temperature' : SERIES[p.dataKey as keyof typeof SERIES].label}</span>
            <span className="ml-auto pl-3 font-semibold">
              {fmt(p.value as number)} {unit}
            </span>
          </div>
        ))}
    </div>
  )
}

function Legend({ keys }: { keys: (keyof typeof SERIES)[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
      {keys.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES[k].color }} />
          {SERIES[k].label}
        </span>
      ))}
    </div>
  )
}

export function FillCharts({ trace, targetBarg, ambientC, isothermal }: { trace: TracePoint[]; targetBarg: number; ambientC: number; isothermal: boolean }) {
  const rows = toRows(trace)
  const keys: (keyof typeof SERIES)[] = isothermal ? ['copv', 'source'] : ['copv', 'settled', 'source']
  return (
    <div className={`grid gap-4 ${isothermal ? '' : 'xl:grid-cols-2'}`}>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-xs font-semibold text-slate-700">Pressure vs gas delivered (barg)</figcaption>
        <Legend keys={keys} />
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis type="number" dataKey="x" domain={[0, 'dataMax']} {...axisProps} tickFormatter={(v: number) => `${fmt(v, 1)} kg`} />
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<TooltipBox unit="barg" />} cursor={{ stroke: INK.axis }} isAnimationActive={false} />
            <ReferenceLine
              y={targetBarg}
              stroke={INK.secondary}
              strokeWidth={1}
              label={{ value: `Target ${fmt(targetBarg, 0)} barg`, position: 'insideTopLeft', fill: INK.secondary, fontSize: 11 }}
            />
            {keys.map((k) => (
              <Line
                key={k}
                dataKey={k}
                stroke={SERIES[k].color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: '#fcfcfb', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </figure>
      {!isothermal && (
        <figure className="flex flex-col gap-2">
          <figcaption className="text-xs font-semibold text-slate-700">COPV gas temperature vs gas delivered (°C)</figcaption>
          <div className="text-[11px] text-slate-500">Gas temperature only; heating of the composite from strain is not modelled.</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis type="number" dataKey="x" domain={[0, 'dataMax']} {...axisProps} tickFormatter={(v: number) => `${fmt(v, 1)} kg`} />
              <YAxis {...axisProps} width={44} />
              <Tooltip content={<TooltipBox unit="°C" />} cursor={{ stroke: INK.axis }} isAnimationActive={false} />
              <ReferenceLine
                y={ambientC}
                stroke={INK.secondary}
                strokeWidth={1}
                label={{ value: `Ambient ${fmt(ambientC)} °C`, position: 'insideBottomLeft', fill: INK.secondary, fontSize: 11 }}
              />
              <Line
                dataKey="temp"
                stroke={SERIES.copv.color}
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
