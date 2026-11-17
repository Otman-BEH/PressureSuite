import { useState, type ReactNode } from 'react'
import { fmt, fmtMin, MACHINES, sourceName, SOURCE_REF_TEMP_C, STATUS } from '../format'
import { useStore } from '../store'
import type { StepOut } from '../types'
import { FillCharts } from './FillChart'
import { TimelineCharts } from './TimelineCharts'
import { Chip, Panel, Segmented } from './ui'

function Stat({ label, value, unit, sub, title }: { label: string; value: string; unit?: string; sub?: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200" title={title}>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">
        {value} {unit && <span className="text-xs font-normal text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

const th = 'px-2 py-1.5 text-left text-[11px] font-medium text-slate-500 whitespace-nowrap'
const td = 'px-2 py-1.5 whitespace-nowrap tabular-nums'

export function ResultsPanel() {
  const sim = useStore((s) => s.sim)
  const sources = useStore((s) => s.sources)
  const sequenceLength = useStore((s) => s.sequence.length)
  const mode = useStore((s) => s.settings.mode)
  const ambient = useStore((s) => s.settings.ambientTempC)
  const result = sim.result
  const timeOn = useStore((s) => s.timeModel.enabled)
  const [plot, setPlot] = useState<'sequence' | 'delivered'>('sequence')
  const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
  const isothermal = mode === 'isothermal'

  if (sim.error)
    return (
      <Panel title="Results">
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">Simulation failed: {sim.error}</p>
      </Panel>
    )
  if (!result || sequenceLength === 0)
    return (
      <Panel title="Results">
        <p className="text-sm text-slate-500">Add sources to the fill sequence to simulate the cascade.</p>
      </Panel>
    )

  const s = result.summary
  const used = result.sources.filter((r) => r.connections > 0 || r.used_kg < -1e-9)
  const anyLeak = result.steps.some((st) => st.leaked_kg > 0)
  const anyMachine = result.steps.some((st) => st.energy_kwh > 0)
  const anyHx = result.steps.some((st) => st.hx_outlet_max_c !== null)
  const anyTime = result.steps.some((st) => st.duration_min !== null)
  const stepName = (st: StepOut) => {
    const label =
      st.source_ids && st.source_ids.length > 1
        ? `Manifold (${st.source_ids.map((id) => labels.get(id) ?? '?').join(' + ')})`
        : (labels.get(st.source_id ?? '') ?? 'no source')
    if (st.type === 'cooldown') return 'Cool-down'
    const into = st.target_id ? ` → ${labels.get(st.target_id) ?? '?'}` : ''
    if (st.type === 'pump') return `${[...(st.feed_machines ?? []), st.machine ?? 'booster'].map((k) => MACHINES[k].name).join(' → ')}: ${label}${into}`
    if (st.type === 'source' && into) return `${label}${into}`
    if (st.type === 'recovery') return st.machine ? `Recovery compressor → ${label}` : `Recovery valve → ${label}`
    if (st.type === 'vent') return 'Vent to atmosphere'
    return label
  }

  return (
    <Panel
      title="Results"
      aside={
        <button
          type="button"
          onClick={() => useStore.getState().commitFill()}
          disabled={s.connections === 0}
          title="Saves this fill to the history, carries every source's leftover gas into the inventory and starts a new, empty COPV"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:bg-slate-300"
        >
          Fill next COPV →
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {result.warnings.length > 0 && (
          <ul className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            {result.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <Stat
            label={`COPV settled at ${fmt(ambient)} °C`}
            value={fmt(s.copv_settled.pressure_barg)}
            unit="barg"
            sub={
              s.target_reached ? (
                <Chip className="bg-emerald-50 text-emerald-800 ring-emerald-200">✓ Target reached</Chip>
              ) : (
                <Chip className="bg-amber-50 text-amber-800 ring-amber-200">⚠ {fmt(s.shortfall_bar)} bar short</Chip>
              )
            }
          />
          {!isothermal && (
            <>
              <Stat label="End of fill (hot)" value={fmt(s.copv_end.pressure_barg)} unit="barg" sub={`${fmt(s.copv_end.temp_c)} °C gas`} />
              <Stat label="Peak gas temperature" value={fmt(s.peak_gas_temp_c)} unit="°C" sub="COPV gas, not the wall" />
            </>
          )}
          <Stat
            label="Gas delivered"
            value={fmt(s.delivered_kg, 2)}
            unit="kg"
            sub={[
              s.parallel > 1 ? `${fmt(s.delivered_kg / s.parallel, 2)} kg into each of ${s.parallel} COPVs` : '',
              s.leaked_kg > 0 ? `+ ${fmt(s.leaked_kg, 2)} kg leaked` : 'no leak loss',
            ].filter(Boolean).join(' · ')}
          />
          <Stat
            label="Wasted exergy"
            value={fmt(s.wasted_exergy_kj, 0)}
            unit="kJ"
            sub="throttling + cooling losses"
            title="Work potential destroyed when gas throttles across a pressure difference and when hot gas cools. A good cascade keeps it low."
          />
          <Stat label="Sources opened" value={`${s.sources_opened}`} sub={`${s.connections} connections · ${s.cooldowns} cool-downs`} />
          {s.pump_energy_kwh > 0 && (
            <Stat label="Pumping" value={fmt(s.pump_energy_kwh, 2)} unit="kWh" sub={timeOn ? `≈ ${fmtMin(s.pump_time_min)} at rated flow` : 'machine work'} />
          )}
          {s.time && (
            <Stat
              label="Cycle time per COPV"
              value={fmtMin(s.time.total_min)}
              sub={`hook-up ${fmtMin(s.time.handling_min)} · fill ${fmtMin(s.time.fill_min)} · settle ${fmtMin(s.time.settle_min)} · hold ${fmtMin(s.time.hold_min)}${s.time.after_test_min > 0 ? ` · after test ${fmtMin(s.time.after_test_min)}` : ''}`}
              title="Estimate only: temperatures and pressures follow the selected thermodynamic model."
            />
          )}
          {s.hx_duty_kwh !== 0 && (
            <Stat
              label="Heat exchanger"
              value={fmt(s.hx_duty_kwh, 3)}
              unit={s.hx_duty_kwh > 0 ? 'kWh removed' : 'kWh added'}
              sub={s.hx_chiller_kwh > 0 ? `chiller work ≥ ${fmt(s.hx_chiller_kwh, 3)} kWh` : 'no chiller needed'}
            />
          )}
          {s.vented_kg > 0 && s.copv_after_test && (
            <Stat label="Vented after test" value={fmt(s.vented_kg, 2)} unit="kg" sub={`COPV gas ends at ${fmt(s.copv_after_test.temp_c)} °C`} />
          )}
          {s.recovered_kg > 0 && (
            <Stat
              label="Recovered after test"
              value={fmt(s.recovered_kg, 2)}
              unit="kg"
              sub={`${fmt(s.recovery_energy_kwh, 2)} kWh${timeOn ? ` · ≈ ${fmtMin(s.recovery_time_min)}` : ''}`}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-700">Plots</h3>
            <Segmented<'sequence' | 'delivered'>
              label="Plot against"
              value={plot}
              onChange={setPlot}
              options={[
                { value: 'sequence', label: timeOn ? 'Over time' : 'Step by step' },
                { value: 'delivered', label: 'Against gas delivered' },
              ]}
            />
          </div>
          {plot === 'sequence' ? (
            <TimelineCharts timeline={result.timeline} sources={sources} targetBarg={s.target_barg} ambientC={ambient} isothermal={isothermal} />
          ) : (
            <FillCharts trace={result.trace} targetBarg={s.target_barg} ambientC={ambient} isothermal={isothermal} />
          )}
        </div>

        <details className="rounded-lg ring-1 ring-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700 select-none hover:bg-slate-50">
            Step-by-step details
            <span className="ml-2 font-normal text-slate-500">every step, and each source after the fill</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-slate-100 px-3 py-3">
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold text-slate-700">Steps</h3>
              <table className="w-full text-xs text-slate-700">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Step</th>
                    <th className={th}>Result</th>
                    <th className={`${th} text-right`}>Gas moved (kg)</th>
                    {anyLeak && <th className={`${th} text-right`}>Leaked (kg)</th>}
                    <th className={`${th} text-right`}>COPV after (barg)</th>
                    {!isothermal && <th className={`${th} text-right`}>COPV gas (°C)</th>}
                    <th className={`${th} text-right`}>Source after (barg)</th>
                    {!isothermal && <th className={`${th} text-right`}>Source gas (°C)</th>}
                    {anyMachine && <th className={`${th} text-right`}>Machine outlet max (°C)</th>}
                    {anyMachine && <th className={`${th} text-right`}>Energy (kWh)</th>}
                    {anyHx && <th className={`${th} text-right`}>HX exit (°C)</th>}
                    {anyTime && <th className={`${th} text-right`}>Time</th>}
                    <th className={`${th} text-right`}>Settled gain (bar)</th>
                    <th className={`${th} text-right`}>Wasted exergy (kJ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.steps.map((st) => (
                    <tr key={st.index} title={st.message} className={st.type === 'recovery' || st.type === 'vent' ? 'bg-slate-50' : ''}>
                      <td className={td}>{st.index}</td>
                      <td className={td}>{stepName(st)}</td>
                      <td className={td}>
                        <Chip className={STATUS[st.status].chip}>{STATUS[st.status].label}</Chip>
                      </td>
                      <td className={`${td} text-right`}>{fmt(st.delivered_kg, 2)}</td>
                      {anyLeak && <td className={`${td} text-right`}>{fmt(st.leaked_kg, 2)}</td>}
                      <td className={`${td} text-right`}>{fmt(st.copv_after.pressure_barg)}</td>
                      {!isothermal && <td className={`${td} text-right`}>{fmt(st.copv_after.temp_c)}</td>}
                      <td className={`${td} text-right`}>{st.source_after ? fmt(st.source_after.pressure_barg) : '–'}</td>
                      {!isothermal && <td className={`${td} text-right`}>{st.source_after ? fmt(st.source_after.temp_c) : '–'}</td>}
                      {anyMachine && <td className={`${td} text-right`}>{st.outlet_temp_max_c !== null ? fmt(st.outlet_temp_max_c) : '–'}</td>}
                      {anyMachine && <td className={`${td} text-right`}>{st.energy_kwh > 0 ? fmt(st.energy_kwh, 3) : '–'}</td>}
                      {anyHx && (
                        <td className={`${td} text-right`}>
                          {st.hx_outlet_max_c === null
                            ? '–'
                            : Math.abs(st.hx_outlet_max_c - (st.hx_outlet_min_c ?? 0)) < 0.5
                              ? fmt(st.hx_outlet_max_c, 0)
                              : `${fmt(st.hx_outlet_min_c ?? 0, 0)} – ${fmt(st.hx_outlet_max_c, 0)}`}
                        </td>
                      )}
                      {anyTime && <td className={`${td} text-right`}>{st.duration_min !== null ? fmtMin(st.duration_min) : '–'}</td>}
                      <td className={`${td} text-right`}>{fmt(st.settled_gain_bar)}</td>
                      <td className={`${td} text-right`}>{fmt(st.wasted_exergy_kj, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {used.length > 0 && (
              <div className="overflow-x-auto">
                <h3 className="mb-1 text-xs font-semibold text-slate-700">Sources after this fill</h3>
                <table className="w-full text-xs text-slate-700">
                  <thead className="border-b border-slate-200">
                    <tr>
                      <th className={th}>Source</th>
                      <th className={`${th} text-right`}>Start (barg)</th>
                      <th className={`${th} text-right`}>End of fill (barg)</th>
                      {!isothermal && <th className={`${th} text-right`}>End gas (°C)</th>}
                      <th className={`${th} text-right`}>Settled at {fmt(ambient)} °C (barg)</th>
                      <th className={`${th} text-right`}>At {SOURCE_REF_TEMP_C} °C ref. (barg)</th>
                      <th className={`${th} text-right`}>Gas used / recovered (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {used.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{labels.get(r.id)}</td>
                        <td className={`${td} text-right`}>{fmt(r.start.pressure_barg)}</td>
                        <td className={`${td} text-right`}>{fmt(r.end.pressure_barg)}</td>
                        {!isothermal && <td className={`${td} text-right`}>{fmt(r.end.temp_c)}</td>}
                        <td className={`${td} text-right`}>{fmt(r.settled_barg)}</td>
                        <td className={`${td} text-right`}>{fmt(r.pressure_ref_barg)}</td>
                        <td className={`${td} text-right`}>{r.used_kg < 0 ? `${fmt(-r.used_kg, 2)} recovered` : fmt(r.used_kg, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </div>
    </Panel>
  )
}
