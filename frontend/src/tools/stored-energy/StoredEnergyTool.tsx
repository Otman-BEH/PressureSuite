import { useEffect, useState } from 'react'
import { ToolActions } from '../../shared/files'
import { fmt, fmtEnergy, fmtP, fmtSig } from '../../shared/format'
import { Assumptions, Chip, Notes, NumberField, Panel, SelectField, Stat, Toggle } from '../../shared/ui'
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
  const { load, reset } = useStore.getState()
  return (
    <div className="flex flex-col gap-4">
      <ToolActions tool="stored-energy" title="Stored Energy" inputs={inputs} onImport={load} onReset={reset} />
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
              hint={`= ${fmtP(inputs.pressureBarg + (meta?.gauge_reference_bara ?? 1))} bar a`}
            />
            <NumberField label="Temperature" unit="°C" value={inputs.tempC} min={-273} max={1700} digits={1} onChange={(tempC) => set({ tempC })} />
          </div>
          <p className="text-[11px] text-slate-500">Released to 1 bar a; gauge pressures are relative to it.</p>
        </div>
      </Panel>
      <Panel title="Vessel wall (liquids)">
        <div className="flex flex-col gap-3">
          <Toggle label="Include wall strain energy" checked={inputs.wallEnabled} onChange={(wallEnabled) => set({ wallEnabled })} />
          {inputs.wallEnabled && <WallFields wall={inputs.wall} onChange={(wall) => set({ wall })} />}
          <p className="text-[11px] text-slate-500">Thin-wall membrane theory. Only added for liquids; next to a gas it is negligible.</p>
        </div>
      </Panel>
    </div>
  )
}

function MethodRow({ label, kj, hint, primary = false }: { label: string; kj: number; hint?: string; primary?: boolean }) {
  return (
    <tr className={primary ? 'font-semibold text-slate-900' : 'text-slate-700'}>
      <td className="py-1.5 pr-3">
        {label}
        {hint && <div className="text-[11px] font-normal text-slate-500">{hint}</div>}
      </td>
      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{fmtEnergy(kj)}</td>
    </tr>
  )
}

function EnergyPanel({ r, loading }: { r: StoredEnergyResponse; loading: boolean }) {
  return (
    <Panel
      title="Stored energy"
      aside={
        <span className="flex items-center gap-2">
          {loading && <span className="text-[11px] text-slate-400">Updating…</span>}
          <Chip className={r.phase === 'gas' ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-teal-50 text-teal-800 ring-teal-200'}>
            {r.phase === 'gas' ? 'Gas' : 'Liquid'}
          </Chip>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat strong label="Energy released" value={fmtEnergy(r.energy_kj)} sub={r.method} />
          <Stat strong label="TNT equivalent" value={`${fmtSig(r.tnt.tnt_kg)} kg`} sub={r.equivalents[0] ? `≈ ${fmtSig(r.equivalents[0].count)} hand grenades` : undefined} />
          <Stat label="Contents" value={`${fmtSig(r.mass_kg)} kg`} sub={`${fmtSig(r.density_kg_m3)} kg/m³`} />
          <Stat label="State" value={`${fmtP(r.pressure_barg)} barg`} sub={`${fmtP(r.pressure_bara)} bar a · ${fmtP(r.temp_c, 1)} °C`} />
        </div>
        {r.gas && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <MethodRow primary label="Real gas, isentropic expansion to 1 bar a" hint="m [(u₁ − u₂ₛ) − pₐ(v₂ₛ − v₁)], CoolProp" kj={r.gas.real_isentropic_kj} />
              <MethodRow label="Real gas, expansion work only" hint="m (u₁ − u₂ₛ): same basis as the ideal isentropic formula" kj={r.gas.real_expansion_work_kj} />
              <MethodRow label="Ideal gas, isentropic (Lloyd / ASME PCC-2)" hint={`p₁V/(γ−1) [1 − (pₐ/p₁)^((γ−1)/γ)], γ = ${fmt(r.gas.gamma, 3)}`} kj={r.gas.ideal_isentropic_kj} />
              <MethodRow label="Ideal gas, Brode" hint="(p₁ − pₐ)V/(γ−1)" kj={r.gas.ideal_brode_kj} />
            </tbody>
          </table>
        )}
        {r.gas && (
          <p className="text-[11px] text-slate-500">
            Compressibility factor Z = {fmt(r.gas.compressibility_z, 3)}. Temperature after isentropic expansion {fmt(r.gas.end_temp_c, 1)} °C
            {r.gas.end_quality !== null && ` (two-phase, vapour fraction ${fmt(r.gas.end_quality, 2)})`}.
          </p>
        )}
        {r.liquid && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <MethodRow label="Liquid compressibility" hint={`p²V / (2K), K = ${fmt(r.liquid.bulk_modulus_mpa, 0)} MPa from CoolProp`} kj={r.liquid.fluid_kj} />
              {r.liquid.wall_kj !== null ? (
                <MethodRow label="Vessel wall strain" hint="Thin-wall membrane, = p ΔV_wall / 2" kj={r.liquid.wall_kj} />
              ) : (
                <tr className="text-slate-500">
                  <td className="py-1.5">Vessel wall strain</td>
                  <td className="py-1.5 text-right text-xs">not included</td>
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
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-1.5 pr-3 text-slate-700">
                TNT
                <div className="text-[11px] text-slate-500">{fmt(r.tnt.factor_mj_per_kg * 1000, 0)} kJ per kg</div>
              </td>
              <td className="py-1.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">{fmtSig(r.tnt.tnt_kg)} kg</td>
            </tr>
            {r.equivalents.map((e) => (
              <tr key={e.name}>
                <td className="py-1.5 pr-3 text-slate-700">
                  {e.name}
                  <div className="text-[11px] text-slate-500">
                    {fmtEnergy(e.unit_kj)} each · {e.reference}
                  </div>
                </td>
                <td className="py-1.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">{fmtSig(e.count)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-slate-500">For a sense of scale only; not a blast or hazard assessment.</p>
      </div>
    </Panel>
  )
}

function Footer({ meta }: { meta: StoredEnergyMeta | null }) {
  return (
    <footer className="px-1 pb-2 text-[11px] text-slate-500">
      {meta && (
        <p>
          CoolProp {meta.coolprop_version} · {meta.backend} backend.
        </p>
      )}
      <p>
        Gauge pressures are relative to {meta?.gauge_reference_bara ?? 1} bar a. Energies are for an instantaneous release to 1 bar a.
      </p>
    </footer>
  )
}

/** The Stored Energy tool: energy in a pressurised vessel, TNT and other energy equivalents. */
export function StoredEnergyTool() {
  const inputs = useStore((s) => s.inputs)
  const [meta, setMeta] = useState<StoredEnergyMeta | null>(null)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    api.meta().then(setMeta, () => setOffline(true))
  }, [])
  const { result, error, loading } = useCalculation(JSON.stringify(inputs), (signal) => api.calculate(inputs, signal))

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:w-80">
        <InputsPanel meta={meta} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-4">
        {offline && <Notes error="Backend not reachable. Start it with: python run.py (in backend/)." />}
        <Notes error={error} />
        {result && (
          <>
            <EnergyPanel r={result} loading={loading} />
            <EquivalentsPanel r={result} />
            <Notes notes={result.notes} />
            <Assumptions notes={result.notes} />
          </>
        )}
        <Footer meta={meta} />
      </main>
    </div>
  )
}
