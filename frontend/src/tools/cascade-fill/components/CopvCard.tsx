import { fmt, fmtMin, sourceName } from '../format'
import { copvsDone, currentBarg, parallelCount, useStore } from '../store'
import type { AfterTest, Fluid, Summary } from '../types'
import { Chip, NumberField, Segmented } from '../../../shared/ui'

const GAS_COLOR: Record<Fluid, string> = { Nitrogen: '#2a78d6', Helium: '#4a3aa7' }

/** Capsule-shaped vessel whose fill level is the settled pressure relative to the target. */
function VesselGraphic({ fluid, summary }: { fluid: Fluid; summary?: Summary }) {
  const W = 96
  const H = 200
  const targetY = H * 0.18 // the target sits near the top; overfills show above it
  const frac = summary ? Math.max(0, summary.copv_settled.pressure_barg / summary.target_barg) : 0
  const levelY = H - Math.min(frac * (H - targetY), H - 6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-24 shrink-0" role="img" aria-label="COPV fill level">
      <defs>
        <clipPath id="copv-clip">
          <rect x="4" y="4" width={W - 8} height={H - 8} rx={(W - 8) / 2} />
        </clipPath>
      </defs>
      <rect x="4" y="4" width={W - 8} height={H - 8} rx={(W - 8) / 2} fill="#f1f5f9" />
      <g clipPath="url(#copv-clip)">
        <rect x="0" y={levelY} width={W} height={H - levelY} fill={GAS_COLOR[fluid]} opacity="0.85" />
        {/* overwrap hoop bands */}
        {[0.3, 0.45, 0.6, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="white" strokeOpacity="0.25" strokeWidth="1" />
        ))}
      </g>
      <rect x="4" y="4" width={W - 8} height={H - 8} rx={(W - 8) / 2} fill="none" stroke="#334155" strokeWidth="3" />
      <rect x={W / 2 - 7} y="0" width="14" height="7" rx="2" fill="#334155" />
      <line x1="0" x2={W} y1={targetY} y2={targetY} stroke="#0b0b0b" strokeWidth="1.5" />
      <text x={W - 6} y={targetY - 4} textAnchor="end" fontSize="10" fill="#52514e">
        target
      </text>
    </svg>
  )
}

function Counter() {
  const done = useStore((s) => copvsDone(s.history))
  const parallel = useStore((s) => parallelCount(s.manifold))
  const count = useStore((s) => s.copvCount)
  const setCount = useStore.getState().setCopvCount
  const allDone = done >= count
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2">
      <div>
        <div className="text-[11px] font-medium text-slate-500">Test campaign</div>
        <div className="text-lg leading-tight font-semibold text-slate-900 tabular-nums">
          {allDone
            ? `All ${count} done`
            : parallel > 1 && done + parallel <= count
              ? `COPV #${done + 1}–${done + parallel} of ${count}`
              : `COPV #${done + 1} of ${count}`}
        </div>
      </div>
      <NumberField className="w-28" label="COPVs to test" value={count} onChange={(n) => setCount(Math.round(n))} min={1} max={50} digits={0} />
    </div>
  )
}

function AfterTestSettings() {
  const afterTest = useStore((s) => s.afterTest)
  const sources = useStore((s) => s.sources)
  const fluid = useStore((s) => s.copv.fluid)
  const timeOn = useStore((s) => s.timeModel.enabled)
  const mode = useStore((s) => s.settings.mode)
  const summary = useStore((s) => (s.view === 'manual' ? s.sim.result?.summary : undefined))
  const setAfterTest = useStore.getState().setAfterTest
  const label = sources.find((s) => s.id === afterTest.vesselId)?.label
  const after = summary?.copv_after_test
  const timing = (min: number) => (timeOn ? ` · ${fmtMin(min)}` : '')
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-xs" onPointerDown={(e) => e.stopPropagation()}>
      <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">After the test</div>
      <Segmented<AfterTest['action']>
        label="After the test"
        value={afterTest.action}
        onChange={(action) => setAfterTest({ action })}
        options={[
          { value: 'none', label: 'Keep', title: 'Leave the gas in the COPV' },
          { value: 'vent', label: 'Vent', title: 'Blow the COPV down to atmosphere; the gas is lost' },
          { value: 'recover', label: 'Recover', title: 'Valve then compressor back into a bundle' },
        ]}
      />
      {afterTest.action === 'vent' && (
        <>
          <NumberField label="Vent down to" value={afterTest.ventToBarg} onChange={(ventToBarg) => setAfterTest({ ventToBarg })} min={0} max={1000} unit="barg" />
          {summary && after && summary.vented_kg > 0 && (
            <p className="text-slate-700 tabular-nums">
              Vents <b>{fmt(summary.vented_kg, 2)} kg</b>; COPV gas ends at <b>{fmt(after.temp_c)} °C</b>
              {timing(summary.time?.after_test_min ?? 0)}
              {mode === 'adiabatic' && (
                <span className="block text-[11px] text-amber-800">
                  Worst case: no heat from the COPV wall. Adiabatic + wall gives a more realistic blowdown temperature.
                </span>
              )}
            </p>
          )}
        </>
      )}
      {afterTest.action === 'recover' && (
        <>
          <select
            value={afterTest.vesselId ?? ''}
            onChange={(e) => setAfterTest({ vesselId: e.target.value || null })}
            className="rounded-md bg-white px-2 py-1 text-xs ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">Recovery bundle…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id} disabled={s.fluid !== fluid}>
                {sourceName(s)} · {fmt(currentBarg(s), 0)} barg
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            The COPV first vents into the bundle through a valve, then the compressor pumps the rest down to its minimum inlet. Tip: add an empty
            bundle (0 barg) to use as the recovery bundle.
          </p>
          {summary && after && summary.recovered_kg > 0 && (
            <p className="text-slate-700 tabular-nums">
              Recovers <b>{fmt(summary.recovered_kg, 2)} kg</b> into {label}; COPV left at {fmt(after.pressure_barg)} barg ·{' '}
              {fmt(summary.recovery_energy_kwh, 2)} kWh{timing(summary.recovery_time_min)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function CopvCard() {
  const copv = useStore((s) => s.copv)
  const mode = useStore((s) => s.settings.mode)
  const ambient = useStore((s) => s.settings.ambientTempC)
  const view = useStore((s) => s.view)
  const summary = useStore((s) => (s.view === 'manual' ? s.sim.result?.summary : s.opt.result?.best?.summary)) ?? undefined
  const setCopv = useStore.getState().setCopv
  const isothermal = mode === 'isothermal'
  const timeOn = useStore((s) => s.timeModel.enabled)
  const parallel = useStore((s) => parallelCount(s.manifold))

  return (
    <section className="flex w-full shrink-0 flex-col rounded-xl bg-white ring-2 ring-slate-800 2xl:w-80">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{parallel > 1 ? `Target COPVs ×${parallel}` : "Target COPV"}</h2>
        <Segmented<Fluid>
          label="COPV gas"
          value={copv.fluid}
          onChange={(fluid) => setCopv({ fluid })}
          options={[
            { value: 'Nitrogen', label: 'N₂' },
            { value: 'Helium', label: 'He' },
          ]}
        />
      </header>
      <Counter />

      <div className="flex gap-4 p-4">
        <VesselGraphic fluid={copv.fluid} summary={summary} />
        <div className="flex min-w-0 flex-col gap-2 text-xs text-slate-600">
          <div>
            <div className="text-[11px] font-medium text-slate-500">Settled at {fmt(ambient)} °C</div>
            <div className="text-2xl font-semibold text-slate-900">
              {summary ? fmt(summary.copv_settled.pressure_barg) : '–'} <span className="text-sm font-normal text-slate-500">barg</span>
            </div>
            {summary &&
              (summary.target_reached ? (
                <Chip className="bg-emerald-50 text-emerald-800 ring-emerald-200">✓ Target {fmt(copv.targetBarg, 0)} barg reached</Chip>
              ) : (
                <Chip className="bg-amber-50 text-amber-800 ring-amber-200">⚠ Short by {fmt(summary.shortfall_bar)} bar</Chip>
              ))}
          </div>
          {summary && !isothermal && (
            <>
              <div>
                <div className="text-[11px] font-medium text-slate-500">End of fill (hot)</div>
                <div className="tabular-nums">
                  <b className="text-slate-800">{fmt(summary.copv_end.pressure_barg)} barg</b> · {fmt(summary.copv_end.temp_c)} °C gas
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Peak gas temperature</div>
                <div className="font-semibold text-slate-800 tabular-nums">{fmt(summary.peak_gas_temp_c)} °C</div>
              </div>
            </>
          )}
          {summary && (
            <div className="tabular-nums">
              {fmt(summary.copv_settled.mass_kg / summary.parallel, 2)} kg of gas {summary.parallel > 1 ? "in each COPV" : "in the COPV"}
            </div>
          )}
          {view === 'optimize' && summary && <span className="text-[11px] text-slate-400">Showing the best optimizer plan</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3 md:grid-cols-4 2xl:grid-cols-2">
        <NumberField label="Volume" value={copv.volumeL} onChange={(volumeL) => setCopv({ volumeL })} min={0.1} max={100000} unit="L" />
        <NumberField
          label={`Target (settled at ${fmt(ambient)} °C)`}
          value={copv.targetBarg}
          onChange={(targetBarg) => setCopv({ targetBarg })}
          min={0.1}
          max={1000}
          unit="barg"
        />
        <NumberField label="Starting pressure" value={copv.initialBarg} onChange={(initialBarg) => setCopv({ initialBarg })} min={0} max={1000} unit="barg" />
        <NumberField
          label="Leak loss per test"
          value={copv.leakPct}
          onChange={(leakPct) => setCopv({ leakPct })}
          min={0}
          max={50}
          unit="%"
          title="Extra gas lost through fittings and hoses during each fill: every COPV costs (1 + this %) of its gas from the inventory."
        />
        {(mode === 'adiabatic_wall' || timeOn) && (
          <>
            <NumberField label="Wall mass (liner + overwrap)" value={copv.wallMassKg} onChange={(wallMassKg) => setCopv({ wallMassKg })} min={0} max={100000} unit="kg" />
            <NumberField
              label="Wall specific heat"
              value={copv.wallCpJkgK}
              onChange={(wallCpJkgK) => setCopv({ wallCpJkgK })}
              min={1}
              max={10000}
              unit="J/kg·K"
              digits={0}
            />
            <p className="col-span-2 text-[11px] text-slate-500 md:col-span-4 2xl:col-span-2">
              {mode === 'adiabatic_wall'
                ? 'The wall is assumed to stay at the gas temperature, so this mode slightly under-predicts gas heating. Real fills sit between Adiabatic and this mode.'
                : 'Used by the time estimate for cool-down times.'}
            </p>
          </>
        )}
      </div>
      <AfterTestSettings />
    </section>
  )
}
