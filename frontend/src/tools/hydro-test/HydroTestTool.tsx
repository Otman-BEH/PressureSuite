import { PressureTimeChart } from '../../shared/cycles'
import { ToolActions } from '../../shared/files'
import { ToolLayout } from '../../shared/ToolLayout'
import { energyParts, fmt, fmtEnergy, fmtMin, fmtP, fmtSig } from '../../shared/format'
import { LeakPanel } from '../../shared/leak'
import { useStoredFlag } from '../../shared/storage'
import { CycleTable, ExpansionPanel, RatesPanel, Sub, type ResultColumn } from '../../shared/testTool'
import { Assumptions, Button, IconButton, Lamp, LinkButton, Notes, NumberField, OptionalNumberField, Panel, Readout, ReadoutRow, Segmented, SelectField, TBODY, TD, TH, THEAD } from '../../shared/ui'
import { useCalculation } from '../../shared/useCalculation'
import { openInStoredEnergy } from '../stored-energy/store'
import { api } from './api'
import { useStore } from './store'
import type { CycleOut, HydroTestResponse, TestFluid } from './types'

function InputsPanel() {
  const inputs = useStore((s) => s.inputs)
  const { set, setLeak } = useStore.getState()
  return (
    <>
      <Panel title="Tank and test fluid">
        <div className="flex flex-col gap-3">
          <SelectField<TestFluid>
            label="Test fluid"
            value={inputs.fluid}
            onChange={(fluid) => set({ fluid })}
            options={[
              { value: 'Water', label: 'Water' },
              { value: 'Ethanol', label: 'Ethanol' },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Internal volume" unit="L" value={inputs.volumeL} min={0.001} max={1_000_000} digits={3} onChange={(volumeL) => set({ volumeL })} />
            <NumberField label="Fluid temperature" unit="°C" value={inputs.tempC} min={-100} max={300} digits={1} onChange={(tempC) => set({ tempC })} />
          </div>
        </div>
      </Panel>
      <ExpansionPanel noun="tank" enabled={inputs.wallEnabled} wall={inputs.wall} onChange={set} />
      <RatesPanel pressurisation={inputs.pressurisationBarMin} vent={inputs.ventBarMin} onChange={set} />
      <LeakPanel
        tool="hydro-test"
        context={{
          fluid: inputs.fluid,
          volumeL: inputs.volumeL,
          tempC: inputs.tempC,
          wall: inputs.wallEnabled ? inputs.wall : null,
          suggestedStartBarg: inputs.cycles[0]?.targetBarg ?? 300,
        }}
        settings={inputs.leak}
        onChange={setLeak}
      />
    </>
  )
}

const COLUMNS = (r: HydroTestResponse): ResultColumn<CycleOut>[] => [
  {
    header: 'Pumped in',
    cell: (c) => (
      <>
        {fmtSig(c.pumped_l)} L{r.tank_dilation_per_bar !== null && <Sub>{fmtSig(c.pumped_tank_l)} L tank</Sub>}
      </>
    ),
    total: `${fmtSig(r.totals.pumped_l)} L`,
  },
  { header: 'Energy', cell: (c) => fmtEnergy(c.energy_kj), total: `max ${fmtEnergy(r.totals.peak_energy_kj)}` },
  { header: 'Returned', cell: (c) => `${fmtSig(c.returned_l)} L`, total: `${fmtSig(r.totals.returned_l)} L` },
  { header: 'Duration', cell: (c) => fmtMin(c.duration_min), total: fmtMin(r.totals.duration_min) },
]

function Cycles({ result }: { result: HydroTestResponse | null }) {
  const inputs = useStore((s) => s.inputs)
  const st = useStore.getState()
  return (
    <CycleTable<CycleOut>
      cycles={inputs.cycles}
      results={result?.cycles ?? null}
      columns={result ? COLUMNS(result) : COLUMNS_EMPTY}
      lostLabel={(c) => `${fmtSig(c.leaked_l * 1e3)} mL lost`}
      lostTotal={result && `${fmtSig(result.totals.leaked_l * 1e3)} mL lost`}
      cycleCount={result?.totals.cycle_count ?? null}
      recording={inputs.recording}
      repeatOn={inputs.repeatOn}
      repeat={inputs.repeat}
      footnote="Volumes are liquid at 1 bar a and the test temperature."
      setCycle={st.setCycle}
      addCycle={st.addCycle}
      removeCycle={st.removeCycle}
      replaceCycles={st.replaceCycles}
      setOptions={st.set}
    />
  )
}

const COLUMNS_EMPTY: ResultColumn<CycleOut>[] = ['Pumped in', 'Energy', 'Returned', 'Duration'].map((header) => ({ header, cell: () => '–' }))

function SummaryPanel({ result, loading }: { result: HydroTestResponse; loading: boolean }) {
  const inputs = useStore((s) => s.inputs)
  const t = result.totals
  return (
    <Panel
      title="Summary"
      aside={
        <div className="flex items-center gap-3">
          {loading && <span className="text-small text-muted">Updating…</span>}
          <LinkButton
            title="Open this tank, full at the test pressure, in the Stored Energy tab"
            onClick={() =>
              openInStoredEnergy({
                fluid: inputs.fluid,
                volumeL: inputs.volumeL,
                pressureBarg: t.test_pressure_barg,
                tempC: inputs.tempC,
                wallEnabled: inputs.wallEnabled,
                wall: inputs.wall,
              })
            }
          >
            Stored energy details →
          </LinkButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ReadoutRow>
          <Readout size="lg" label="Test pressure" value={fmtP(t.test_pressure_barg)} unit="barg" sub="highest cycle target" />
          <Readout size="lg" label="Liquid pumped in" value={fmtSig(t.pumped_l)} unit="L" sub={`${fmtSig(t.returned_l)} L back on venting`} />
          <Readout size="lg" label="Test duration" value={fmtMin(t.duration_min)} sub={`${fmt(t.cycle_count, 0)} cycle${t.cycle_count === 1 ? '' : 's'}`} />
          <Readout size="lg" label="Max stored energy" value={energyParts(t.peak_energy_kj)[0]} unit={energyParts(t.peak_energy_kj)[1]} sub="at the test pressure, liquid + tank wall" />
        </ReadoutRow>
        <p className="font-mono text-small text-muted">
          {inputs.fluid} at 1 bar a: {fmt(result.density_kg_m3, 1)} kg/m³, bulk modulus {fmt(result.bulk_modulus_mpa, 0)} MPa · tank{' '}
          {result.tank_dilation_per_bar === null ? 'rigid' : `stretches ${fmtSig(result.tank_dilation_per_bar * 1e6)} ppm/bar`}
          {t.leaked_l > 0 && ` · ${fmtSig(t.leaked_l * 1e3)} mL lost in measured holds`}
        </p>
      </div>
    </Panel>
  )
}

/** Tank volume, or the gas pocket in it, from liquid pumped in (and returned) between two pressures, over repeated runs. */
function VolumeCheckPanel() {
  const [open, setOpen] = useStoredFlag('hydro-test:volume-open', true)
  const inputs = useStore((s) => s.inputs)
  const { setVolumeCheck: setV, setVolumeRun, addVolumeRun, removeVolumeRun } = useStore.getState()
  const v = inputs.volumeCheck
  const { result, error } = useCalculation(JSON.stringify([v, inputs.fluid, inputs.tempC, inputs.volumeL, inputs.wallEnabled, inputs.wall]), (signal) =>
    api.volumeCheck(inputs, signal),
  )
  const pocket = v.mode === 'gas_pocket'
  const unitRow = 'font-mono font-normal tracking-normal normal-case'
  const explain = pocket
    ? `Pump a measured amount in and read the pressure rise: with the tank volume from the inputs (${fmtSig(inputs.volumeL)} L), the extra liquid over what a gas-free tank takes is the gas being compressed (Boyle's law, real gas). Gas volumes are given at 1 bar a so runs from different pressures compare. Measuring what comes back on venting ("depress") checks each run.`
    : 'Pump a measured amount in and read the pressure rise: with the tank full of liquid, that sets its volume through the liquid compressibility and the tank stretch. Measuring what comes back on venting ("depress") checks each run.'
  return (
    <Panel
      title="Before cycling: volume and trapped gas check"
      collapsed={!open}
      onToggle={() => setOpen(!open)}
      collapsedAside={
        result && (
          <span className="font-mono text-small text-ink">
            {pocket ? 'Gas pocket' : 'Tank volume'} {fmtSig(result.mean_l)} L · {result.count} value{result.count === 1 ? '' : 's'}
          </span>
        )
      }
      aside={
        <Segmented
          label="What to find"
          value={v.mode}
          onChange={(mode) => setV({ mode })}
          options={[
            { value: 'tank', label: 'Tank volume', title: 'Tank completely full of liquid' },
            { value: 'gas_pocket', label: 'Gas pocket', title: 'Trapped air or ullage in a tank of known volume' },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-small text-muted" title={explain}>
          One run per press: pumped-in volume between two pressures; every value is averaged.
        </p>
        {pocket && (
          <SelectField
            className="w-48"
            label="Gas in the pocket"
            value={v.pocketGas}
            onChange={(pocketGas) => setV({ pocketGas })}
            options={[
              { value: 'Air', label: 'Air' },
              { value: 'Nitrogen', label: 'Nitrogen' },
              { value: 'Helium', label: 'Helium' },
            ]}
          />
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>
                  From<div className={unitRow}>barg</div>
                </th>
                <th className={TH}>
                  To<div className={unitRow}>barg</div>
                </th>
                <th className={TH}>
                  Pumped in<div className={unitRow}>L</div>
                </th>
                <th className={TH} title="Optional: liquid that came back on venting">
                  Returned<div className={unitRow}>L, optional</div>
                </th>
                <th className={`${TH} text-right`}>
                  {pocket ? 'Gas pocket' : 'Tank volume'}
                  <div className={unitRow}>L, press</div>
                </th>
                <th className={`${TH} text-right`}>
                  Depress<div className={unitRow}>L</div>
                </th>
                <th className={`${TH} text-right`} title={pocket ? 'What a gas-free tank takes for the same pressure rise' : `What a ${fmtSig(inputs.volumeL)} L tank takes for the same pressure rise`}>
                  {pocket ? 'Gas-free tank' : `${fmtSig(inputs.volumeL)} L tank`}
                  <div className={unitRow}>L, takes</div>
                </th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className={TBODY}>
              {v.runs.map((r, i) => {
                const out = result?.runs[i]
                const off = out?.difference_pct != null && Math.abs(out.difference_pct) > 2
                return (
                  <tr key={r.uid}>
                    <td className="px-2 py-1.5 font-mono text-small text-muted">{i + 1}</td>
                    <td className="px-2 py-1">
                      <NumberField className="w-20" alignRight value={r.fromBarg} min={0} max={10_000} digits={2} onChange={(fromBarg) => setVolumeRun(r.uid, { fromBarg })} />
                    </td>
                    <td className="px-2 py-1">
                      <NumberField className="w-20" alignRight value={r.toBarg} min={0.01} max={10_000} digits={2} onChange={(toBarg) => setVolumeRun(r.uid, { toBarg })} />
                    </td>
                    <td className="px-2 py-1">
                      <NumberField className="w-24" alignRight value={r.pumpedL} min={0.000001} max={1_000_000} digits={4} onChange={(pumpedL) => setVolumeRun(r.uid, { pumpedL })} />
                    </td>
                    <td className="px-2 py-1">
                      <OptionalNumberField className="w-24" alignRight placeholder="not read" value={r.returnedL} min={0.000001} max={1_000_000} digits={4} onChange={(returnedL) => setVolumeRun(r.uid, { returnedL })} />
                    </td>
                    <td className={TD}>{out ? fmtSig(out.from_press_l) : '–'}</td>
                    <td className={TD}>
                      {out?.from_depress_l != null ? fmtSig(out.from_depress_l) : '–'}
                      {out?.difference_pct != null &&
                        (off ? (
                          <div>
                            <Lamp status="warn" title="Press and depress differ by more than 2 %">
                              {fmt(out.difference_pct, 1)} % apart
                            </Lamp>
                          </div>
                        ) : (
                          <div className="text-muted">{fmt(out.difference_pct, 1)} % apart</div>
                        ))}
                    </td>
                    <td className={`${TD} text-muted`}>{out?.expected_pumped_l != null ? fmtSig(out.expected_pumped_l) : '–'}</td>
                    <td className="px-1 py-1.5">
                      {v.runs.length > 1 && (
                        <IconButton label={`Remove run ${i + 1}`} onClick={() => removeVolumeRun(r.uid)}>
                          ×
                        </IconButton>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div>
          <Button variant="primary" onClick={addVolumeRun}>
            Add run
          </Button>
        </div>
        {result && (
          <ReadoutRow className="border-t border-rule pt-3 sm:grid-cols-4">
            <Readout
              size="lg"
              label={pocket ? 'Gas pocket (at 1 bar a), average' : 'Tank volume, average'}
              value={fmtSig(result.mean_l)}
              unit="L"
              sub={`over ${result.count} value${result.count === 1 ? '' : 's'}`}
            />
            {result.spread_pct !== null && <Readout label="Spread" value={fmt(result.spread_pct, 1)} unit="%" title="(max − min) / average" />}
            {result.pocket_energy_kj !== null && result.liquid_energy_kj !== null && (
              <Readout label="Energy, gas pocket / liquid" value={`${fmtEnergy(result.pocket_energy_kj)} / ${fmtEnergy(result.liquid_energy_kj)}`} sub="at the highest run pressure" />
            )}
          </ReadoutRow>
        )}
        <Notes error={error} notes={result?.notes} withAssumptions />
      </div>
    </Panel>
  )
}

/** The Hydrostatic Test tool: fluid to pump in and back, stored energy, timing, leaks and volume checks. */
export function HydroTestTool() {
  const inputs = useStore((s) => s.inputs)
  const cycleKey = JSON.stringify({ ...inputs, volumeCheck: undefined, leak: undefined })
  const { result, error, loading } = useCalculation(cycleKey, (signal) => api.calculate(inputs, signal))
  const passes = result ? result.totals.cycle_count / inputs.cycles.length : 1
  const { load, reset } = useStore.getState()

  return (
    <ToolLayout
      name="Hydrostatic Test"
      actions={<ToolActions tool="hydro-test" title="Hydrostatic Test" inputs={inputs} onImport={load} onReset={reset} />}
      inputs={<InputsPanel />}
    >
        <Notes error={error} className="px-3 py-2" />
        <VolumeCheckPanel />
        {result && <SummaryPanel result={result} loading={loading} />}
        <Cycles result={result} />
        {result && (
          <PressureTimeChart
            timeline={result.timeline}
            caption={passes > 1 ? `First two passes of ${fmt(passes, 0)}; totals cover all ${fmt(result.totals.cycle_count, 0)} cycles.` : undefined}
          />
        )}
        {result && <Notes notes={result.notes} className="px-3 py-2" />}
        {result && <Assumptions notes={result.notes} className="px-3 py-2" />}
    </ToolLayout>
  )
}
