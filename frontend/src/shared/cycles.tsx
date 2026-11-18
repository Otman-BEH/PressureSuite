import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtMin, fmtSig } from './format'
import { NumberField, OptionalNumberField, Panel } from './ui'

/** One test cycle as edited in the hydrostatic and gas test tabs (API: CycleIn). */
export interface Cycle {
  uid: string
  targetBarg: number
  holdMin: number
  ventBarg: number
  ventHoldMin: number
  /** Pressure read at the end of the hold at target; null when not measured. Gives the leak rate. */
  measuredEndHoldBarg: number | null
}

export interface TimePoint {
  t_min: number
  pressure_barg: number
  phase: string
  cycle: number
}

/** Fields every cycle result has (API: CycleOut / GasCycleOut). */
export interface CycleResultBase {
  index: number
  start_barg: number
  target_barg: number
  end_hold_barg: number
  vent_barg: number
  hold_drop_bar: number
  leak_rate_bar_min: number | null
  duration_min: number
}

export const uid = () => Math.random().toString(36).slice(2, 10)
export const newCycle = (targetBarg = 300): Cycle => ({ uid: uid(), targetBarg, holdMin: 5, ventBarg: 0, ventHoldMin: 0, measuredEndHoldBarg: null })

/** API cycles; measured end-of-hold pressures are only sent while recording readings. */
export const cyclesPayload = (cycles: Cycle[], recording: boolean) =>
  cycles.map((c) => ({
    target_barg: c.targetBarg,
    hold_min: c.holdMin,
    vent_barg: c.ventBarg,
    vent_hold_min: c.ventHoldMin,
    measured_end_hold_barg: recording ? c.measuredEndHoldBarg : null,
  }))

/** Brings saved cycles from older versions up to date (missing hold at vent or measured pressure, proof-based targets). */
export function upgradeCycles(saved: unknown, fallback: Cycle[], defaultTarget = 300): Cycle[] {
  if (!Array.isArray(saved) || saved.length === 0) return fallback
  return saved.map((c: Partial<Cycle>) => ({
    uid: c.uid ?? uid(),
    targetBarg: c.targetBarg ?? defaultTarget,
    holdMin: c.holdMin ?? 5,
    ventBarg: c.ventBarg ?? 0,
    ventHoldMin: c.ventHoldMin ?? 0,
    measuredEndHoldBarg: c.measuredEndHoldBarg ?? null,
  }))
}

/** Column headers of the editable cells; the unit sits under the name so the inputs can stay narrow. */
export const cycleInputHeaders = (recording: boolean) => [
  { name: 'Target', unit: 'barg' },
  { name: 'Hold', unit: 'min' },
  ...(recording ? [{ name: 'End of hold', unit: 'barg, read' }] : []),
  { name: 'Vent to', unit: 'barg' },
  { name: 'Hold at vent', unit: 'min' },
]

/** The editable cells of a cycle row: target, hold, (measured end of hold), vent-down pressure, hold at vent. */
export function CycleInputCells({ cycle, recording, onChange }: { cycle: Cycle; recording: boolean; onChange: (patch: Partial<Cycle>) => void }) {
  const cell = 'px-1.5 py-1.5'
  return (
    <>
      <td className={cell}>
        <NumberField className="w-[4.5rem]" value={cycle.targetBarg} min={0.01} max={10_000} digits={2} onChange={(targetBarg) => onChange({ targetBarg })} />
      </td>
      <td className={cell}>
        <NumberField className="w-14" value={cycle.holdMin} min={0} max={100_000} digits={1} onChange={(holdMin) => onChange({ holdMin })} />
      </td>
      {recording && (
        <td className={cell}>
          <OptionalNumberField
            className="w-20"
            value={cycle.measuredEndHoldBarg}
            min={0}
            max={10_000}
            digits={3}
            placeholder="not read"
            onChange={(measuredEndHoldBarg) => onChange({ measuredEndHoldBarg })}
          />
        </td>
      )}
      <td className={cell}>
        <NumberField className="w-[4.5rem]" value={cycle.ventBarg} min={0} max={10_000} digits={2} onChange={(ventBarg) => onChange({ ventBarg })} />
      </td>
      <td className={cell}>
        <NumberField className="w-14" value={cycle.ventHoldMin} min={0} max={100_000} digits={1} onChange={(ventHoldMin) => onChange({ ventHoldMin })} />
      </td>
    </>
  )
}

/** Leak rate of a measured hold, in bar/min, or a dash. */
export function leakRateLabel(r: CycleResultBase): string {
  return r.leak_rate_bar_min === null ? '–' : `${fmtSig(r.leak_rate_bar_min)} bar/min`
}

/** The repeat count to send: 1 when the switch is off. */
export const repeatPayload = (on: boolean, count: number) => (on ? Math.max(1, Math.round(count)) : 1)

export const anyMeasured = (cycles: Cycle[]) => cycles.some((c) => c.measuredEndHoldBarg !== null)

const INK = { muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', line: '#2a78d6', measured: '#d0352b' }
const axisProps = { tick: { fill: INK.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: INK.axis } } as const
const MEASURED = 'Hold (measured)'

function ChartTooltip({ active, payload, timeline }: { active?: boolean; payload?: { payload: TimePoint }[]; timeline: TimePoint[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const i = timeline.indexOf(p)
  const rate = p.phase === MEASURED && i > 0 ? (timeline[i - 1].pressure_barg - p.pressure_barg) / (p.t_min - timeline[i - 1].t_min) : null
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <div className="font-medium text-slate-500">
        {p.cycle > 0 ? `Cycle ${p.cycle} · ` : ''}
        {p.phase} · {fmtMin(p.t_min)}
      </div>
      <div className="font-semibold text-slate-900 tabular-nums">{fmt(p.pressure_barg, 3)} barg</div>
      {rate !== null && <div className="text-rose-700 tabular-nums">leak {fmtSig(rate)} bar/min</div>}
    </div>
  )
}

function Dot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TimePoint }) {
  if (cx === undefined || cy === undefined) return null
  const measured = payload?.phase === MEASURED
  return <circle cx={cx} cy={cy} r={measured ? 4 : 2} fill={measured ? INK.measured : INK.line} stroke="white" strokeWidth={measured ? 1 : 0} />
}

/** Pressure against time over all cycles; holds with a measured end pressure are marked in red. */
export function PressureTimeChart({ timeline, caption }: { timeline: TimePoint[]; caption?: string }) {
  const measured = timeline.some((p) => p.phase === MEASURED)
  return (
    <Panel title="Pressure vs time">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={timeline} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="t_min" type="number" domain={[0, 'dataMax']} {...axisProps} tickFormatter={(v: number) => `${fmt(v, 0)}`} unit=" min" />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmt(v, 0)} unit=" bar" />
            <Tooltip content={<ChartTooltip timeline={timeline} />} />
            <Line type="linear" dataKey="pressure_barg" stroke={INK.line} strokeWidth={2} dot={<Dot />} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {caption && <p className="mt-1 text-[11px] text-slate-500">{caption}</p>}
      {measured && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="inline-block size-2 rounded-full" style={{ background: INK.measured }} /> end of a hold with a measured pressure (hover for the leak rate)
        </p>
      )}
    </Panel>
  )
}
