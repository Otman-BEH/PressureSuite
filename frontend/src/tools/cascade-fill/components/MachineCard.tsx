import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmt, MACHINES } from '../format'
import { useStore } from '../store'
import type { MachineKind, MachinePreview } from '../types'
import { BoosterIcon, CompressorIcon } from './icons'
import { Group, Modal } from './Modal'
import { NumberField } from '../../../shared/ui'

function OutletCheck({ kind }: { kind: MachineKind }) {
  const spec = useStore((s) => s.equipment[kind])
  const fluid = useStore((s) => s.copv.fluid)
  const ambient = useStore((s) => s.settings.ambientTempC)
  const target = useStore((s) => s.copv.targetBarg)
  const [inlet, setInlet] = useState(kind === 'booster' ? 150 : 5)
  const [outlet, setOutlet] = useState(target)
  const [preview, setPreview] = useState<MachinePreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.machinePreview(fluid, ambient, spec, inlet, outlet, controller.signal).then(
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
  }, [fluid, ambient, spec, inlet, outlet])

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Outlet check ({fluid})</div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Feed pressure" value={inlet} onChange={setInlet} min={0} max={1000} unit="barg" />
        <NumberField label="Outlet pressure" value={outlet} onChange={setOutlet} min={0} max={2000} unit="barg" />
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      {preview && !error && (
        <div className="mt-2 text-xs text-slate-700">
          <div className="tabular-nums">
            Outlet gas <b className="text-slate-900">{fmt(preview.outlet_temp_c)} °C</b> · {fmt(preview.work_kj_per_kg)} kJ/kg · ratio{' '}
            {fmt(preview.ratio)}:1
          </div>
          {preview.notes.map((n) => (
            <div key={n} className={preview.runs ? 'text-slate-500' : 'text-amber-800'}>
              {preview.runs ? 'ℹ' : '⚠'} {n}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MachineCard({ kind }: { kind: MachineKind }) {
  const spec = useStore((s) => s.equipment[kind])
  const timeOn = useStore((s) => s.timeModel.enabled)
  const { setMachine, resetMachine } = useStore.getState()
  const set = (patch: Partial<typeof spec>) => setMachine(kind, patch)
  const Icon = kind === 'booster' ? BoosterIcon : CompressorIcon

  return (
    <Modal
      title={MACHINES[kind].name}
      subtitle={MACHINES[kind].role}
      icon={<Icon className="size-9 text-amber-600" />}
      footer={
        <button type="button" onClick={() => resetMachine(kind)} className="text-xs text-slate-500 hover:text-slate-800">
          Reset to defaults
        </button>
      }
    >
      <Group title="Inlet operating range" note="Below the minimum the machine stops. Feed above the maximum is throttled by an inlet regulator.">
        <NumberField label="Minimum inlet" value={spec.inletMinBarg} onChange={(v) => set({ inletMinBarg: v })} min={0} max={spec.inletMaxBarg} unit="barg" />
        <NumberField label="Maximum inlet" value={spec.inletMaxBarg} onChange={(v) => set({ inletMaxBarg: v })} min={Math.max(spec.inletMinBarg, 0.1)} max={1000} unit="barg" />
      </Group>

      <Group title="Outlet">
        <NumberField label="Maximum outlet" value={spec.outletMaxBarg} onChange={(v) => set({ outletMaxBarg: v })} min={0.1} max={2000} unit="barg" />
        <NumberField label="Maximum pressure ratio" value={spec.maxRatio} onChange={(v) => set({ maxRatio: v })} min={1.01} max={1000} unit=": 1" />
      </Group>

      <Group title="Compression" note="No aftercooler: gas leaves at the last stage's discharge temperature. Add the heat exchanger to cool it before the COPV.">
        <NumberField label="Stages" value={spec.stages} onChange={(v) => set({ stages: Math.round(v) })} min={1} max={8} digits={0} />
        <NumberField label="Isentropic efficiency" value={spec.efficiencyPct} onChange={(v) => set({ efficiencyPct: v })} min={11} max={100} unit="%" digits={0} />
        <label className="col-span-2 flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={spec.intercooled} onChange={(e) => set({ intercooled: e.target.checked })} className="accent-sky-600" />
          Intercooled to ambient between stages
        </label>
        {timeOn && (
          <NumberField
            className="col-span-2"
            label="Flow (for the pumping-time estimate)"
            value={spec.flowNm3h}
            onChange={(v) => set({ flowNm3h: v })}
            min={0.01}
            max={100000}
            unit="Nm³/h"
          />
        )}
      </Group>

      <OutletCheck kind={kind} />
    </Modal>
  )
}
