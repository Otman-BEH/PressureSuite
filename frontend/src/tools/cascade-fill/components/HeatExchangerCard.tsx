import { useEffect, useState } from 'react'
import { api } from '../api'
import { DEFAULT_HX, fmt } from '../format'
import { useStore } from '../store'
import type { HeatExchanger, HxPreview } from '../types'
import { HeatExchangerIcon } from './icons'
import { Group, Modal, Switch } from './Modal'
import { NumberField, Segmented } from '../../../shared/ui'

function OutletCheck() {
  const hx = useStore((s) => s.heatExchanger)
  const fluid = useStore((s) => s.copv.fluid)
  const ambient = useStore((s) => s.settings.ambientTempC)
  const target = useStore((s) => s.copv.targetBarg)
  const [inletC, setInletC] = useState(80)
  const [pressure, setPressure] = useState(target)
  const [preview, setPreview] = useState<HxPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.hxPreview(fluid, ambient, hx, inletC, pressure, controller.signal).then(
        (p) => {
          setPreview(p)
          setError(null)
        },
        (e: Error) => !controller.signal.aborted && setError(e.message),
      )
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [fluid, ambient, hx, inletC, pressure])

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Outlet check ({fluid})</div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Gas in" value={inletC} onChange={setInletC} min={-200} max={1000} unit="°C" />
        <NumberField label="Line pressure" value={pressure} onChange={setPressure} min={0} max={1000} unit="barg" />
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      {preview && !error && (
        <div className="mt-2 text-xs text-slate-700 tabular-nums">
          Gas out <b className="text-slate-900">{fmt(preview.outlet_temp_c)} °C</b> · {preview.duty_kj_per_kg >= 0 ? 'removes' : 'adds'}{' '}
          {fmt(Math.abs(preview.duty_kj_per_kg))} kJ/kg
          {preview.chiller_kj_per_kg > 0 && <> · chiller ≥ {fmt(preview.chiller_kj_per_kg)} kJ/kg</>}
        </div>
      )}
    </div>
  )
}

export function HeatExchangerCard() {
  const hx = useStore((s) => s.heatExchanger)
  const isothermal = useStore((s) => s.settings.mode === 'isothermal')
  const set = useStore.getState().setHeatExchanger

  return (
    <Modal
      title="Heat exchanger"
      subtitle="In the fill line, just before the COPV (after valves and pumps)"
      icon={<HeatExchangerIcon className="size-9 text-teal-600" />}
      footer={
        <button type="button" onClick={() => set(DEFAULT_HX)} className="text-xs text-slate-500 hover:text-slate-800">
          Reset to defaults
        </button>
      }
    >
      <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200">
        Installed in the fill line
        <Switch checked={hx.installed} onChange={(installed) => set({ installed })} label="Heat exchanger installed" />
      </label>
      {isothermal && <p className="text-xs text-amber-800">No effect in the isothermal model: the COPV stays at ambient there anyway.</p>}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Control</span>
        <Segmented<HeatExchanger['control']>
          label="Control"
          value={hx.control}
          onChange={(control) => set({ control })}
          options={[
            { value: 'outlet_temp', label: 'Set gas exit temperature' },
            { value: 'effectiveness', label: 'Effectiveness' },
          ]}
        />
      </div>

      {hx.control === 'outlet_temp' ? (
        <Group title="Gas exit" note="Ideal control: the gas always leaves at this temperature, whatever comes in.">
          <NumberField className="col-span-2" label="Gas exit temperature" value={hx.outletTempC} onChange={(outletTempC) => set({ outletTempC })} min={-200} max={300} unit="°C" />
        </Group>
      ) : (
        <Group title="Coolant" note="Gas exit = gas in − effectiveness × (gas in − coolant). Coolant at ambient acts as an air or water cooler.">
          <NumberField label="Coolant temperature" value={hx.coolantTempC} onChange={(coolantTempC) => set({ coolantTempC })} min={-200} max={300} unit="°C" />
          <NumberField label="Effectiveness" value={hx.effectivenessPct} onChange={(effectivenessPct) => set({ effectivenessPct })} min={1} max={100} unit="%" digits={0} />
        </Group>
      )}

      <p className="text-[11px] text-slate-500">
        In a fast fill most of the COPV heating happens inside the vessel, as incoming gas compresses the gas already there. Cold inlet gas
        lowers it but cannot remove it: filling from empty, the gas ends near γ × inlet temperature (γ ≈ 1.67 for helium, 1.4 for nitrogen).
      </p>

      <OutletCheck />
    </Modal>
  )
}
