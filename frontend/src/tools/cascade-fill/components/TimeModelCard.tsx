import { DEFAULT_TIME, fmt } from '../format'
import { useStore } from '../store'
import { ClockIcon } from './icons'
import { Group, Modal, Switch } from './Modal'
import { Button, NumberField, Segmented, SelectField } from '../../../shared/ui'

const MM_PER_IN = 25.4

/** Common instrument tubing (OD × wall, inches); the flow diameter is the inner diameter, OD − 2 × wall. */
const TUBES: { id: string; od: string; wall: number; odIn: number }[] = [
  { id: '1/8x0.028', od: '1/8"', odIn: 0.125, wall: 0.028 },
  { id: '1/4x0.035', od: '1/4"', odIn: 0.25, wall: 0.035 },
  { id: '1/4x0.049', od: '1/4"', odIn: 0.25, wall: 0.049 },
  { id: '1/4x0.065', od: '1/4"', odIn: 0.25, wall: 0.065 },
  { id: '3/8x0.065', od: '3/8"', odIn: 0.375, wall: 0.065 },
  { id: '1/2x0.083', od: '1/2"', odIn: 0.5, wall: 0.083 },
]
const innerMm = (t: (typeof TUBES)[number]) => (t.odIn - 2 * t.wall) * MM_PER_IN

/** Flow diameter: a tubing preset (or custom) and the inner diameter in mm or inches. */
function FlowDiameter() {
  const tm = useStore((s) => s.timeModel)
  const set = useStore.getState().setTimeModel
  const inches = tm.orificeUnit === 'in'
  const preset = TUBES.find((t) => Math.abs(innerMm(t) - tm.orificeMm) < 1e-3)?.id ?? 'custom'
  return (
    <>
      <SelectField
        className="col-span-2"
        label="Tubing (OD × wall)"
        value={preset}
        onChange={(id) => {
          const t = TUBES.find((x) => x.id === id)
          if (t) set({ orificeMm: innerMm(t) })
        }}
        options={[
          ...TUBES.map((t) => ({
            value: t.id,
            label: `${t.od} × ${t.wall.toFixed(3)}" wall · ID ${(t.odIn - 2 * t.wall).toFixed(3)}" (${fmt(innerMm(t), 2)} mm)`,
          })),
          { value: 'custom', label: 'Custom diameter' },
        ]}
      />
      <NumberField
        label="Inner diameter"
        value={inches ? tm.orificeMm / MM_PER_IN : tm.orificeMm}
        onChange={(v) => set({ orificeMm: inches ? v * MM_PER_IN : v })}
        min={inches ? 0.002 : 0.05}
        max={inches ? 4 : 100}
        digits={inches ? 3 : 2}
        unit={inches ? 'in' : 'mm'}
        title="Smallest flow diameter in the line: tube inner diameter, valve or fitting orifice, whichever is smaller"
      />
      <div className="flex flex-col justify-end">
        <Segmented<'mm' | 'in'>
          label="Diameter unit"
          value={tm.orificeUnit}
          onChange={(orificeUnit) => set({ orificeUnit })}
          options={[
            { value: 'in', label: 'in' },
            { value: 'mm', label: 'mm' },
          ]}
        />
      </div>
    </>
  )
}

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
      icon={<ClockIcon className="size-9 text-ink" />}
      footer={
        <Button variant="quiet" onClick={() => set({ ...DEFAULT_TIME, enabled: tm.enabled })}>
          Reset to defaults
        </Button>
      }
    >
      <label className="flex items-center justify-between gap-3 bg-surface px-3 py-2 text-body text-ink ring-1 ring-rule">
        Show time estimates
        <Switch checked={tm.enabled} onChange={(enabled) => set({ enabled })} label="Time estimate on" />
      </label>

      <Group
        title="Flow"
        note="Valve steps: compressible orifice flow (choked or subsonic) through the inner diameter, discharge coefficient 0.8. Use the smallest diameter in the line (a valve seat can be smaller than the tube inner diameter). Pumps use their rated flow."
      >
        <FlowDiameter />
        <NumberField
          className="col-span-2"
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
        <label className="col-span-2 flex items-center gap-2 text-small text-ink">
          <input
            type="checkbox"
            checked={tm.copvAreaM2 === null}
            onChange={(e) => set({ copvAreaM2: e.target.checked ? null : Math.round(estimate * 100) / 100 })}
           
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
