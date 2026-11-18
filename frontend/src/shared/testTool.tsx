import { useState, type ReactNode } from 'react'
import { anyMeasured, cycleInputHeaders, CycleInputCells, leakRateLabel, newCycle, type Cycle, type CycleResultBase } from './cycles'
import { fmt } from './format'
import { IconButton, NumberField, Panel, Toggle } from './ui'
import { WallFields, type WallSpec } from './wall'

/** Panels shared by the Hydrostatic Test and Gas Test tabs. */

export function RatesPanel({ pressurisation, vent, onChange }: {
  pressurisation: number
  vent: number
  onChange: (patch: { pressurisationBarMin?: number; ventBarMin?: number }) => void
}) {
  return (
    <Panel title="Rates">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Pressurisation rate" unit="bar/min" value={pressurisation} min={0.01} max={100_000} digits={2} onChange={(pressurisationBarMin) => onChange({ pressurisationBarMin })} />
        <NumberField label="Vent rate" unit="bar/min" value={vent} min={0.01} max={100_000} digits={2} onChange={(ventBarMin) => onChange({ ventBarMin })} />
      </div>
    </Panel>
  )
}

/** Vessel material and geometry, for how much the vessel stretches under pressure. */
export function ExpansionPanel({ noun, enabled, wall, onChange }: {
  noun: 'tank' | 'vessel'
  enabled: boolean
  wall: WallSpec
  onChange: (patch: { wallEnabled?: boolean; wall?: WallSpec }) => void
}) {
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  return (
    <Panel title={`${Noun} expansion`}>
      <div className="flex flex-col gap-3">
        <Toggle label={`Include ${noun} material and geometry`} checked={enabled} onChange={(wallEnabled) => onChange({ wallEnabled })} />
        {enabled ? (
          <WallFields wall={wall} onChange={(w) => onChange({ wall: w })} />
        ) : (
          <p className="text-[11px] text-slate-500">Off: the {noun} is treated as rigid. Turn on to count the {noun} stretching under pressure.</p>
        )}
      </div>
    </Panel>
  )
}

/** "Set up cycles": replace the list with N identical cycles in one go. */
function CycleSetup({ initial, onApply, onClose }: { initial: Cycle; onApply: (cycles: Cycle[]) => void; onClose: () => void }) {
  const [count, setCount] = useState(3)
  const [c, setC] = useState<Cycle>(initial)
  const set = (patch: Partial<Cycle>) => setC((prev) => ({ ...prev, ...patch }))
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg bg-sky-50 p-3 ring-1 ring-sky-200">
      <NumberField className="w-20" label="Cycles" value={count} min={1} max={100} digits={0} onChange={(v) => setCount(Math.round(v))} />
      <NumberField className="w-28" label="Target" unit="barg" value={c.targetBarg} min={0.01} max={10_000} digits={2} onChange={(targetBarg) => set({ targetBarg })} />
      <NumberField className="w-24" label="Hold" unit="min" value={c.holdMin} min={0} max={100_000} digits={1} onChange={(holdMin) => set({ holdMin })} />
      <NumberField className="w-28" label="Vent to" unit="barg" value={c.ventBarg} min={0} max={10_000} digits={2} onChange={(ventBarg) => set({ ventBarg })} />
      <NumberField className="w-24" label="Hold at vent" unit="min" value={c.ventHoldMin} min={0} max={100_000} digits={1} onChange={(ventHoldMin) => set({ ventHoldMin })} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            onApply(Array.from({ length: count }, () => ({ ...newCycle(c.targetBarg), holdMin: c.holdMin, ventBarg: c.ventBarg, ventHoldMin: c.ventHoldMin })))
            onClose()
          }}
          className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700"
        >
          Replace cycles
        </button>
        <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-white">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One result column of the cycle table. */
export interface ResultColumn<R> {
  header: string
  cell: (r: R) => ReactNode
  total?: ReactNode
}

const th = 'px-1.5 py-1.5 text-left text-[11px] font-medium whitespace-nowrap text-slate-500 align-bottom'
const td = 'px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap'

/** Small second line in a result cell. */
export const Sub = ({ children }: { children: ReactNode }) => <div className="text-[11px] font-normal text-slate-500">{children}</div>

/**
 * The editable cycle list with per-cycle results. "Record readings" adds the measured end-of-hold column and the leak
 * rate it gives; "Repeat" runs the list many times; "Set up" replaces the list with N identical cycles.
 */
export function CycleTable<R extends CycleResultBase>({
  cycles, results, columns, lostLabel, lostTotal, cycleCount, recording, repeatOn, repeat, footnote,
  setCycle, addCycle, removeCycle, replaceCycles, setOptions,
}: {
  cycles: Cycle[]
  results: R[] | null
  columns: ResultColumn<R>[]
  /** What a measured hold lost, e.g. "6.5 mL lost". */
  lostLabel: (r: R) => string
  lostTotal?: ReactNode
  cycleCount: number | null
  recording: boolean
  repeatOn: boolean
  repeat: number
  footnote: ReactNode
  setCycle: (uid: string, patch: Partial<Cycle>) => void
  addCycle: () => void
  removeCycle: (uid: string) => void
  replaceCycles: (cycles: Cycle[]) => void
  setOptions: (patch: { recording?: boolean; repeatOn?: boolean; repeat?: number }) => void
}) {
  const [setup, setSetup] = useState(false)
  const headers = cycleInputHeaders(recording)
  const leak = recording && anyMeasured(cycles)
  const repeated = cycleCount !== null && cycleCount > cycles.length
  return (
    <Panel
      title="Test cycles"
      aside={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Toggle label="Record readings" checked={recording} onChange={(r) => setOptions({ recording: r })} />
          <div className="flex items-center gap-2">
            <Toggle label="Repeat" checked={repeatOn} onChange={(on) => setOptions({ repeatOn: on })} />
            {repeatOn && <NumberField className="w-24" unit="times" value={repeat} min={1} max={100_000} digits={0} onChange={(v) => setOptions({ repeat: Math.round(v) })} />}
          </div>
          <button type="button" onClick={() => setSetup((v) => !v)} className="rounded-md px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50">
            Set up…
          </button>
          <button type="button" onClick={addCycle} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700">
            Add cycle
          </button>
        </div>
      }
    >
      {setup && <CycleSetup initial={cycles[0] ?? newCycle()} onApply={replaceCycles} onClose={() => setSetup(false)} />}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200">
            <tr>
              <th className={th}>#</th>
              {headers.map((h) => (
                <th key={h.name} className={th}>
                  {h.name}
                  <div className="font-normal text-slate-400">{h.unit}</div>
                </th>
              ))}
              {leak && <th className={`${th} text-right`}>Leak rate</th>}
              {columns.map((c) => (
                <th key={c.header} className={`${th} text-right`}>
                  {c.header}
                </th>
              ))}
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cycles.map((c, i) => {
              const out = results?.[i]
              return (
                <tr key={c.uid}>
                  <td className="px-1.5 py-1.5 text-slate-500">{i + 1}</td>
                  <CycleInputCells cycle={c} recording={recording} onChange={(patch) => setCycle(c.uid, patch)} />
                  {leak && (
                    <td className={td}>
                      {out ? leakRateLabel(out) : '–'}
                      {out && out.leak_rate_bar_min !== null && <Sub>{lostLabel(out)}</Sub>}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.header} className={td}>
                      {out ? col.cell(out) : '–'}
                    </td>
                  ))}
                  <td className="px-1 py-1.5">
                    {cycles.length > 1 && (
                      <IconButton label={`Remove cycle ${i + 1}`} onClick={() => removeCycle(c.uid)}>
                        ×
                      </IconButton>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {results && (
            <tfoot className="border-t border-slate-200 font-semibold text-slate-900">
              <tr>
                <td className="px-1.5 py-1.5" colSpan={headers.length + 1}>
                  Total
                  {repeated && (
                    <Sub>
                      {cycles.length} × {fmt(cycleCount / cycles.length, 0)} = {fmt(cycleCount, 0)} cycles
                    </Sub>
                  )}
                </td>
                {leak && <td className={td}>{lostTotal}</td>}
                {columns.map((col) => (
                  <td key={col.header} className={td}>
                    {col.total}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {footnote} Each cycle starts where the previous one ended; the first starts at 0 barg.
        {repeatOn && ' The table shows one pass of the list; the totals cover every pass.'}
        {recording
          ? ' Type the pressure read at the end of each hold to get its leak rate; leave it blank if not read.'
          : ' Turn on "Record readings" during the test to enter the pressure at the end of each hold.'}
      </p>
    </Panel>
  )
}
