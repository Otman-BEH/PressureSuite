import { PressureTimeChart } from '../../shared/cycles'
import { ToolActions } from '../../shared/files'
import { fmt, fmtEnergy, fmtMin, fmtP, fmtSig } from '../../shared/format'
import { LeakPanel } from '../../shared/leak'
import { CycleTable, ExpansionPanel, RatesPanel, Sub, type ResultColumn } from '../../shared/testTool'
import { Assumptions, LinkButton, Notes, NumberField, Panel, SelectField, Stat } from '../../shared/ui'
import { useCalculation } from '../../shared/useCalculation'
import { useStore as useCascade } from '../cascade-fill/store'
import { openInStoredEnergy } from '../stored-energy/store'
import { api } from './api'
import { useStore } from './store'
import type { GasCycleOut, GasFluid, GasTestResponse, Inputs } from './types'

const GASES: { value: GasFluid; label: string }[] = [
  { value: 'Nitrogen', label: 'Nitrogen (N₂)' },
  { value: 'Helium', label: 'Helium (He)' },
  { value: 'Air', label: 'Air' },
  { value: 'Argon', label: 'Argon (Ar)' },
  { value: 'Oxygen', label: 'Oxygen (O₂)' },
  { value: 'Hydrogen', label: 'Hydrogen (H₂)' },
  { value: 'Methane', label: 'Methane (CH₄)' },
]

function InputsPanel() {
  const inputs = useStore((s) => s.inputs)
  const { set, setLeak, setSupply, load, reset } = useStore.getState()
  return (
    <div className="flex flex-col gap-4">
      <ToolActions tool="gas-test" title="Gas Test" inputs={inputs} onImport={load} onReset={reset} />
      <Panel title="Vessel and test gas">
        <div className="flex flex-col gap-3">
          <SelectField label="Test gas" value={inputs.fluid} onChange={(fluid) => set({ fluid })} options={GASES} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Internal volume" unit="L" value={inputs.volumeL} min={0.001} max={1_000_000} digits={3} onChange={(volumeL) => set({ volumeL })} />
            <NumberField label="Gas temperature" unit="°C" value={inputs.tempC} min={-100} max={300} digits={1} onChange={(tempC) => set({ tempC })} />
          </div>
        </div>
      </Panel>
      <ExpansionPanel noun="vessel" enabled={inputs.wallEnabled} wall={inputs.wall} onChange={set} />
      <RatesPanel pressurisation={inputs.pressurisationBarMin} vent={inputs.ventBarMin} onChange={set} />
      <Panel title="Gas supply">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Bundle volume"
            unit="L"
            value={inputs.supply.bundleVolumeL}
            min={1}
            max={100_000}
            digits={0}
            hint="e.g. 12 × 50 L = 600 L"
            onChange={(bundleVolumeL) => setSupply({ bundleVolumeL })}
          />
          <NumberField
            label="Bundle pressure"
            unit="barg"
            value={inputs.supply.bundlePressureBarg}
            min={1}
            max={1000}
            digits={0}
            hint="N₂ 300, He 200; set when you pick the gas"
            onChange={(bundlePressureBarg) => setSupply({ bundlePressureBarg })}
          />
          <NumberField
            className="col-span-2"
            label="Booster residual pressure"
            unit="barg"
            value={inputs.supply.residualBarg}
            min={0}
            max={1000}
            digits={0}
            hint="Lowest pressure a booster can draw a bundle down to"
            onChange={(residualBarg) => setSupply({ residualBarg })}
          />
        </div>
      </Panel>
      <LeakPanel
        tool="gas-test"
        context={{
          fluid: inputs.fluid,
          volumeL: inputs.volumeL,
          tempC: inputs.tempC,
          wall: inputs.wallEnabled ? inputs.wall : null,
          suggestedStartBarg: inputs.cycles[0]?.targetBarg ?? 250,
        }}
        settings={inputs.leak}
        onChange={setLeak}
      />
    </div>
  )
}

/** Sets up the Cascade Fill tab to fill this vessel to the test pressure, then opens it. */
function planInCascadeFill(inputs: Inputs, testPressure: number) {
  if (inputs.fluid !== 'Nitrogen' && inputs.fluid !== 'Helium') return
  if (!confirm(`Set the Cascade Fill target to this vessel (${fmtSig(inputs.volumeL)} L ${inputs.fluid}, 0 → ${fmtP(testPressure)} barg at ${fmtP(inputs.tempC, 1)} °C)? This replaces the current target COPV there.`)) return
  const cascade = useCascade.getState()
  cascade.setCopv({ fluid: inputs.fluid, volumeL: inputs.volumeL, targetBarg: testPressure, initialBarg: 0 })
  cascade.setAmbient(Math.min(80, Math.max(-60, inputs.tempC)))
  window.location.hash = '/cascade-fill'
}

function SummaryPanel({ result, loading }: { result: GasTestResponse; loading: boolean }) {
  const inputs = useStore((s) => s.inputs)
  const t = result.totals
  const s = result.supply
  const cascadeGas = inputs.fluid === 'Nitrogen' || inputs.fluid === 'Helium'
  return (
    <Panel
      title="Summary"
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {loading && <span className="text-[11px] text-slate-400">Updating…</span>}
          <LinkButton
            title="Open this vessel, full at the test pressure, in the Stored Energy tab"
            onClick={() =>
              openInStoredEnergy({ fluid: inputs.fluid, volumeL: inputs.volumeL, pressureBarg: t.test_pressure_barg, tempC: inputs.tempC, wallEnabled: false })
            }
          >
            Stored energy details →
          </LinkButton>
          <LinkButton
            disabled={!cascadeGas}
            title={cascadeGas ? 'Plan the actual bundle cascade for one fill to the test pressure' : 'Cascade Fill handles nitrogen and helium only'}
            onClick={() => planInCascadeFill(inputs, t.test_pressure_barg)}
          >
            Plan the fill in Cascade Fill →
          </LinkButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat strong label="Test pressure" value={`${fmtP(t.test_pressure_barg)} barg`} sub="highest cycle target" />
          <Stat strong label="Gas needed" value={`${fmtSig(t.used_kg)} kg`} sub={`${fmtSig(t.used_nm3)} Nm³ (0 °C, 1 atm)`} />
          <Stat strong label="Test duration" value={fmtMin(t.duration_min)} sub={`${fmt(t.cycle_count, 0)} cycle${t.cycle_count === 1 ? '' : 's'}`} />
          <Stat strong label="Max stored energy" value={fmtEnergy(t.peak_energy_kj)} sub={`${fmtSig(t.peak_energy_kj / 4184)} kg TNT`} />
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3 sm:grid-cols-4">
          <Stat
            label={`${fmtP(s.bundle_pressure_barg)} barg bundles, decanting`}
            value={s.bundles_decant === null ? 'Booster needed' : `${s.bundles_decant}`}
            sub={s.decant_usable_kg !== null ? `${fmtSig(s.decant_usable_kg)} kg usable each` : 'bundles not above the test pressure'}
          />
          <Stat label="Bundles with a booster" value={`${s.bundles_booster}`} sub={`${fmtSig(s.booster_usable_kg)} kg usable each, down to ${fmtP(inputs.supply.residualBarg)} barg`} />
          <Stat label="Full bundle" value={`${fmtSig(s.bundle_contents_kg)} kg`} sub={`${fmtSig(s.bundle_contents_nm3)} Nm³ in ${fmt(s.bundle_volume_l, 0)} L`} />
          <Stat
            label="Vented / left in vessel"
            value={`${fmtSig(t.vented_kg)} / ${fmtSig(t.left_in_vessel_kg)} kg`}
            sub={t.leaked_kg > 0 ? `${fmtSig(t.leaked_kg * 1e3)} g lost in measured holds` : undefined}
          />
        </div>
      </div>
    </Panel>
  )
}

const COLUMN_NAMES = ['Gas in', 'Energy', 'Vented', 'Duration']

const columns = (r: GasTestResponse | null): ResultColumn<GasCycleOut>[] =>
  r
    ? [
        {
          header: 'Gas in',
          cell: (c) => (
            <>
              {fmtSig(c.filled_kg)} kg<Sub>{fmtSig(c.filled_nm3)} Nm³</Sub>
            </>
          ),
          total: (
            <>
              {fmtSig(r.totals.used_kg)} kg<Sub>{fmtSig(r.totals.used_nm3)} Nm³</Sub>
            </>
          ),
        },
        {
          header: 'Energy',
          cell: (c) => (
            <>
              {fmtEnergy(c.energy_kj)}
              <Sub>{fmtSig(c.tnt_kg)} kg TNT</Sub>
            </>
          ),
          total: `max ${fmtEnergy(r.totals.peak_energy_kj)}`,
        },
        { header: 'Vented', cell: (c) => `${fmtSig(c.vented_kg)} kg`, total: `${fmtSig(r.totals.vented_kg)} kg` },
        { header: 'Duration', cell: (c) => fmtMin(c.duration_min), total: fmtMin(r.totals.duration_min) },
      ]
    : COLUMN_NAMES.map((header) => ({ header, cell: () => '–' }))

/** The Gas Test tool: pneumatic acceptance test cycles, gas needed, supply bundles, stored energy and leaks. */
export function GasTestTool() {
  const inputs = useStore((s) => s.inputs)
  const st = useStore.getState()
  const key = JSON.stringify({ ...inputs, leak: undefined })
  const { result, error, loading } = useCalculation(key, (signal) => api.calculate(inputs, signal))
  const passes = result ? result.totals.cycle_count / inputs.cycles.length : 1
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:w-80">
        <InputsPanel />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <Notes error={error} />
        {result && <SummaryPanel result={result} loading={loading} />}
        {result && <Notes notes={result.notes.filter((n) => n.level === 'critical')} />}
        <CycleTable<GasCycleOut>
          cycles={inputs.cycles}
          results={result?.cycles ?? null}
          columns={columns(result)}
          lostLabel={(c) => `${fmtSig(c.leaked_kg * 1e3)} g lost`}
          lostTotal={result && `${fmtSig(result.totals.leaked_kg * 1e3)} g lost`}
          cycleCount={result?.totals.cycle_count ?? null}
          recording={inputs.recording}
          repeatOn={inputs.repeatOn}
          repeat={inputs.repeat}
          footnote="Targets are settled pressures at the gas temperature."
          setCycle={st.setCycle}
          addCycle={st.addCycle}
          removeCycle={st.removeCycle}
          replaceCycles={st.replaceCycles}
          setOptions={st.set}
        />
        {result && (
          <PressureTimeChart
            timeline={result.timeline}
            caption={passes > 1 ? `First two passes of ${fmt(passes, 0)}; totals cover all ${fmt(result.totals.cycle_count, 0)} cycles.` : undefined}
          />
        )}
        {result && <Notes notes={result.notes.filter((n) => n.level !== 'critical')} />}
        <footer className="flex flex-col gap-1 px-1 pb-2 text-[11px] text-slate-500">
          {result && <Assumptions notes={result.notes} />}
          <p>Gauge pressures are relative to 1 bar a. Stored energy uses the Stored Energy tool's real-gas calculation. Nm³ at 0 °C and 1 atm.</p>
        </footer>
      </main>
    </div>
  )
}
