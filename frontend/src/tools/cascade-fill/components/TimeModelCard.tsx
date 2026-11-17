import { DEFAULT_TIME, fmt } from '../format'
import { useStore } from '../store'
import { ClockIcon } from './icons'
import { Group, Modal, Switch } from './Modal'
import { NumberField } from './ui'

/** Outer surface of a cylinder with hemispherical ends, 3 diameters long (matches the backend estimate). */
export function estimatedArea(volumeL: number): number {
  const D = (volumeL / 1000 / ((2 * Math.PI) / 3)) ** (1 / 3)
  return 3 * Math.PI * D * D
}

export function TimeModelCard() {
  const tm = useStore((s) => s.timeModel)
  const volumeL = useStore((s) => s.copv.volumeL)
  const set = useStore.getState().setTimeModel
  const estimate = estimatedArea(volumeL)

  return (
    <Modal
      title="Time estimate"
      subtitle="Durations only: temperatures and pressures still follow the thermodynamic model"
      icon={<ClockIcon className="size-9 text-sky-700" />}
      footer={
        <button type="button" onClick={() => set({ ...DEFAULT_TIME, enabled: tm.enabled })} className="text-xs text-slate-500 hover:text-slate-800">
          Reset to defaults
        </button>
      }
    >
      <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200">
        Show time estimates
        <Switch checked={tm.enabled} onChange={(enabled) => set({ enabled })} label="Time estimate on" />
      </label>

      <Group title="Flow" note="Valve steps: compressible orifice flow (choked or subsonic), discharge coefficient 0.8. Pumps use their rated flow.">
        <NumberField label="Valve / line flow diameter" value={tm.orificeMm} onChange={(orificeMm) => set({ orificeMm })} min={0.05} max={100} unit="mm" />
        <NumberField
          label="Max COPV pressure rate"
          value={tm.maxRateBarMin}
          onChange={(maxRateBarMin) => set({ maxRateBarMin })}
          min={0}
          max={10000}
          unit="bar/min"
          title="Fill and depressurization procedures often limit the pressure change rate. 0 = no limit."
        />
      </Group>

      <Group
        title="Cool-down"
        note={
          <>
            Lumped estimate: the gas and the COPV wall (mass and specific heat from the COPV card) cool together through the outer surface.
            Typical h: 5–10 W/m²·K still air, 20–50 with a fan.
          </>
        }
      >
        <NumberField label="Outside heat-transfer coeff." value={tm.hExtWm2K} onChange={(hExtWm2K) => set({ hExtWm2K })} min={0.1} max={10000} unit="W/m²·K" />
        <NumberField label="Done within" value={tm.settleToleranceK} onChange={(settleToleranceK) => set({ settleToleranceK })} min={0.1} max={100} unit="K of ambient" />
        <label className="col-span-2 flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={tm.copvAreaM2 === null}
            onChange={(e) => set({ copvAreaM2: e.target.checked ? null : Math.round(estimate * 100) / 100 })}
            className="accent-sky-600"
          />
          Estimate the COPV outer area from its volume ({fmt(estimate, 2)} m², length = 3 diameters)
        </label>
        {tm.copvAreaM2 !== null && (
          <NumberField className="col-span-2" label="COPV outer area" value={tm.copvAreaM2} onChange={(copvAreaM2) => set({ copvAreaM2 })} min={0.001} max={1000} unit="m²" />
        )}
      </Group>

      <Group title="Operations">
        <NumberField label="Hook-up per connection" value={tm.connectionMin} onChange={(connectionMin) => set({ connectionMin })} min={0} max={1000} unit="min" />
        <NumberField label="Test hold per COPV" value={tm.holdMin} onChange={(holdMin) => set({ holdMin })} min={0} max={10000} unit="min" />
      </Group>
    </Modal>
  )
}
