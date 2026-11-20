import { useEffect, useState } from 'react'
import { ToolActions } from '../../shared/files'
import { ToolLayout } from '../../shared/ToolLayout'
import { energyParts, fmt, fmtEnergy, fmtP, fmtSig } from '../../shared/format'
import { Assumptions, LABEL, Notes, NumberField, Panel, Readout, ReadoutRow, SelectField, TBODY, Toggle } from '../../shared/ui'
import { useCalculation } from '../../shared/useCalculation'
import { WallFields } from '../../shared/wall'
import { api } from './api'
import { useStore } from './store'
import type { CalcFluid, StoredEnergyMeta, StoredEnergyResponse } from './types'

export const FLUID_LABELS: Record<CalcFluid, string> = {
  Nitrogen: 'Nitrogen (N₂)',
  Helium: 'Helium (He)',
  Air: 'Air',
  Argon: 'Argon (Ar)',
  Oxygen: 'Oxygen (O₂)',
  Hydrogen: 'Hydrogen (H₂)',
  Methane: 'Methane (CH₄)',
  CarbonDioxide: 'Carbon dioxide (CO₂)',
  Water: 'Water',
  Ethanol: 'Ethanol',
}

function InputsPanel({ meta }: { meta: StoredEnergyMeta | null }) {
  const inputs = useStore((s) => s.inputs)
  const set = useStore((s) => s.set)
  return (
    <>
      <Panel title="Vessel and contents">
        <div className="flex flex-col gap-3">
          <SelectField
            label="Fluid"
            value={inputs.fluid}
            onChange={(fluid) => set({ fluid })}
            options={(Object.keys(FLUID_LABELS) as CalcFluid[]).map((f) => ({ value: f, label: FLUID_LABELS[f] }))}
          />
          <NumberField label="Internal volume" unit="L" value={inputs.volumeL} min={0.001} max={1_000_000} digits={3} onChange={(volumeL) => set({ volumeL })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Pressure"
              unit="barg"
              value={inputs.pressureBarg}
              min={0.01}
              max={20_000}
              digits={2}
              onChange={(pressureBarg) => set({ pressureBarg })}
            />
            <NumberField label="Temperature" unit="°C" value={inputs.tempC} min={-273} max={1700} digits={1} onChange={(tempC) => set({ tempC })} />
          </div>
          <p className="font-mono text-small text-muted" title="Released to 1 bar a; gauge pressures are relative to it.">
            = {fmtP(inputs.pressureBarg + (meta?.gauge_reference_bara ?? 1))} bar a · released to 1 bar a
          </p>
        </div>
      </Panel>
      <Panel title="Vessel wall (liquids)">
        <div className="flex flex-col gap-3">
          <Toggle
            label="Include wall strain energy"
            title="Thin-wall membrane theory. Only added for liquids; next to a gas it is negligible."
            checked={inputs.wallEnabled}
            onChange={(wallEnabled) => set({ wallEnabled })}
          />
          {inputs.wallEnabled && <WallFields wall={inputs.wall} onChange={(wall) => set({ wall })} />}
        </div>
      </Panel>
    </>
  )
}

function MethodRow({ label, kj, hint, primary = false }: { label: string; kj: number; hint?: string; primary?: boolean }) {
  return (
    <tr className={`text-body text-ink ${primary ? 'font-semibold' : ''}`}>
      <td className="py-1.5 pr-3">
        {label}
        {hint && <div className="font-mono text-small font-normal text-muted">{hint}</div>}
      </td>
      <td className="py-1.5 text-right font-mono whitespace-nowrap">{fmtEnergy(kj)}</td>
    </tr>
  )
}

function EnergyPanel({ r, loading }: { r: StoredEnergyResponse; loading: boolean }) {
  return (
    <Panel
      title="Stored energy"
      aside={
        <span className="flex items-center gap-2">
          {loading && <span className="text-small text-muted">Updating…</span>}
          <span className={LABEL}>{r.phase === 'gas' ? 'Gas' : 'Liquid'}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <ReadoutRow>
          <Readout size="lg" label="Energy released" value={energyParts(r.energy_kj)[0]} unit={energyParts(r.energy_kj)[1]} sub={r.method} />
          <Readout size="lg" label="TNT equivalent" value={fmtSig(r.tnt.tnt_kg)} unit="kg" sub={r.equivalents[0] ? `≈ ${fmtSig(r.equivalents[0].count)} hand grenades` : undefined} />
          <Readout label="Contents" value={fmtSig(r.mass_kg)} unit="kg" sub={`${fmtSig(r.density_kg_m3)} kg/m³`} />
          <Readout label="State" value={fmtP(r.pressure_barg)} unit="barg" sub={`${fmtP(r.pressure_bara)} bar a · ${fmtP(r.temp_c, 1)} °C`} />
        </ReadoutRow>
        {r.gas && (
          <table className="w-full border-t border-rule">
            <tbody className={TBODY}>
              <MethodRow primary label="Real gas, isentropic expansion to 1 bar a" hint="m [(u₁ − u₂ₛ) − pₐ(v₂ₛ − v₁)], CoolProp" kj={r.gas.real_isentropic_kj} />
              <MethodRow label="Real gas, expansion work only" hint="m (u₁ − u₂ₛ): same basis as the ideal isentropic formula" kj={r.gas.real_expansion_work_kj} />
              <MethodRow label="Ideal gas, isentropic (Lloyd / ASME PCC-2)" hint={`p₁V/(γ−1) [1 − (pₐ/p₁)^((γ−1)/γ)], γ = ${fmt(r.gas.gamma, 3)}`} kj={r.gas.ideal_isentropic_kj} />
              <MethodRow label="Ideal gas, Brode" hint="(p₁ − pₐ)V/(γ−1)" kj={r.gas.ideal_brode_kj} />
            </tbody>
          </table>
        )}
        {r.gas && (
          <p className="font-mono text-small text-muted">
            Compressibility factor Z = {fmt(r.gas.compressibility_z, 3)}. Temperature after isentropic expansion {fmt(r.gas.end_temp_c, 1)} °C
            {r.gas.end_quality !== null && ` (two-phase, vapour fraction ${fmt(r.gas.end_quality, 2)})`}.
          </p>
        )}
        {r.liquid && (
          <table className="w-full border-t border-rule">
            <tbody className={TBODY}>
              <MethodRow label="Liquid compressibility" hint={`p²V / (2K), K = ${fmt(r.liquid.bulk_modulus_mpa, 0)} MPa from CoolProp`} kj={r.liquid.fluid_kj} />
              {r.liquid.wall_kj !== null ? (
                <MethodRow label="Vessel wall strain" hint="Thin-wall membrane, = p ΔV_wall / 2" kj={r.liquid.wall_kj} />
              ) : (
                <tr className="text-body text-muted">
                  <td className="py-1.5">Vessel wall strain</td>
                  <td className="py-1.5 text-right text-small">not included</td>
                </tr>
              )}
              <MethodRow primary label="Total" kj={r.liquid.total_kj} />
              {r.liquid.isentropic_kj !== null && (
                <MethodRow label="Cross-check: isentropic expansion to 1 bar a" hint="Real fluid, CoolProp" kj={r.liquid.isentropic_kj} />
              )}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  )
}

function EquivalentsPanel({ r }: { r: StoredEnergyResponse }) {
  return (
    <Panel title="What that energy compares to">
      <div className="flex flex-col gap-3">
        <table className="w-full">
          <tbody className={TBODY}>
            <tr className="text-body text-ink">
              <td className="py-1.5 pr-3">
                TNT
                <div className="font-mono text-small text-muted">{fmt(r.tnt.factor_mj_per_kg * 1000, 0)} kJ per kg</div>
              </td>
              <td className="py-1.5 text-right font-mono font-medium whitespace-nowrap">{fmtSig(r.tnt.tnt_kg)} kg</td>
            </tr>
            {r.equivalents.map((e) => (
              <tr key={e.name} className="text-body text-ink">
                <td className="py-1.5 pr-3">
                  {e.name}
                  <div className="text-small text-muted">
                    {fmtEnergy(e.unit_kj)} each · {e.reference}
                  </div>
                </td>
                <td className="py-1.5 text-right font-mono font-medium whitespace-nowrap">{fmtSig(e.count)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-small text-muted">For a sense of scale only; not a blast or hazard assessment.</p>
      </div>
    </Panel>
  )
}

/** The Stored Energy tool: energy in a pressurised vessel, TNT and other energy equivalents. */
export function StoredEnergyTool() {
  const inputs = useStore((s) => s.inputs)
  const [meta, setMeta] = useState<StoredEnergyMeta | null>(null)
  useEffect(() => {
    api.meta().then(setMeta, () => undefined) // the status bar reports a missing backend
  }, [])
  const { load, reset } = useStore.getState()
  const { result, error, loading } = useCalculation(JSON.stringify(inputs), (signal) => api.calculate(inputs, signal))

  return (
    <ToolLayout
      name="Stored Energy"
      actions={<ToolActions tool="stored-energy" title="Stored Energy" inputs={inputs} onImport={load} onReset={reset} />}
      inputs={<InputsPanel meta={meta} />}
    >
        <Notes error={error} className="px-3 py-2" />
        {result && (
          <>
            <EnergyPanel r={result} loading={loading} />
            <EquivalentsPanel r={result} />
            <Notes notes={result.notes} className="px-3 py-2" />
            <Assumptions notes={result.notes} className="px-3 py-2" />
          </>
        )}
    </ToolLayout>
  )
}
