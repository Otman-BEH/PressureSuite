import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtMin, fmtSig } from './format'
import { axisProps, CHART_MARGIN, ChartFrame, ChartTooltip, cursorProps, gridProps, lineProps, yAxisProps } from './chartTheme'
import { NumberField, OptionalNumberField, Panel } from './ui'
import { COLOR, DATA_VESSEL } from './theme'

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
  const cell = 'px-2 py-1'
  return (
    <>
      <td className={cell}>
        <NumberField className="w-[4.5rem]" alignRight value={cycle.targetBarg} min={0.01} max={10_000} digits={2} onChange={(targetBarg) => onChange({ targetBarg })} />
      </td>
      <td className={cell}>
        <NumberField className="w-14" alignRight value={cycle.holdMin} min={0} max={100_000} digits={1} onChange={(holdMin) => onChange({ holdMin })} />
      </td>
      {recording && (
        <td className={cell}>
          <OptionalNumberField
            className="w-20" alignRight
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
        <NumberField className="w-[4.5rem]" alignRight value={cycle.ventBarg} min={0} max={10_000} digits={2} onChange={(ventBarg) => onChange({ ventBarg })} />
      </td>
      <td className={cell}>
        <NumberField className="w-14" alignRight value={cycle.ventHoldMin} min={0} max={100_000} digits={1} onChange={(ventHoldMin) => onChange({ ventHoldMin })} />
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

// Vessel pressure in the vessel colour; measured end-of-hold points are ink markers (DESIGN.md).
const MEASURED_COLOR = COLOR.ink
const MEASURED = 'Hold (measured)'

function PressureTooltip({ active, payload, timeline }: { active?: boolean; payload?: { payload: TimePoint }[]; timeline: TimePoint[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const i = timeline.indexOf(p)
  const rate = p.phase === MEASURED && i > 0 ? (timeline[i - 1].pressure_barg - p.pressure_barg) / (p.t_min - timeline[i - 1].t_min) : null
  return (
    <ChartTooltip
      header={`${p.cycle > 0 ? `Cycle ${p.cycle} · ` : ''}${p.phase} · ${fmtMin(p.t_min)}`}
      rows={[
        { key: 'p', label: 'Pressure', value: `${fmt(p.pressure_barg, 3)} barg` },
        ...(rate !== null ? [{ key: 'leak', label: 'Leak rate', value: `${fmtSig(rate)} bar/min` }] : []),
      ]}
    />
  )
}

/** Only measured holds get a marker: an 8px ink dot with a surface ring. */
function MeasuredDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TimePoint }) {
  if (cx === undefined || cy === undefined || payload?.phase !== MEASURED) return null
  return <circle cx={cx} cy={cy} r={4} fill={MEASURED_COLOR} stroke={COLOR.surface} strokeWidth={2} />
}

/** Pressure against time over all cycles; holds with a measured end pressure are marked. */
export function PressureTimeChart({ timeline, caption }: { timeline: TimePoint[]; caption?: string }) {
  const measured = timeline.some((p) => p.phase === MEASURED)
  const note = (
    <>
      {caption}
      {measured && (
        <span className="mt-1 flex items-center gap-1.5">
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill={MEASURED_COLOR} />
          </svg>
          end of a hold with a measured pressure (hover for the leak rate)
        </span>
      )}
    </>
  )
  return (
    <Panel title="Pressure vs time">
      <ChartFrame yTitle="Pressure · barg" xTitle="Time · min" height={256} note={caption || measured ? note : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={timeline} margin={CHART_MARGIN}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t_min" type="number" domain={[0, 'dataMax']} {...axisProps} tickFormatter={(v: number) => fmt(v, 0)} />
            <YAxis {...yAxisProps} tickFormatter={(v: number) => fmt(v, 0)} />
            <Tooltip content={<PressureTooltip timeline={timeline} />} cursor={cursorProps} isAnimationActive={false} />
            <Line dataKey="pressure_barg" {...lineProps(DATA_VESSEL, 'vessel')} dot={<MeasuredDot />} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </Panel>
  )
}
