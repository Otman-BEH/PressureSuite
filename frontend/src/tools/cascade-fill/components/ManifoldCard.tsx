import { useStore } from '../store'
import { ManifoldIcon } from './icons'
import { Group, Modal, Switch } from './Modal'
import { NumberField } from '../../../shared/ui'

export function ManifoldCard() {
  const manifold = useStore((s) => s.manifold)
  const copv = useStore((s) => s.copv)
  const set = useStore.getState().setManifold

  return (
    <Modal
      title="Manifold"
      subtitle="Splits the fill line between several COPVs filled together"
      icon={<ManifoldIcon className="size-9 text-slate-700" />}
      footer={<span />}
    >
      <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200">
        Installed (fill COPVs in parallel)
        <Switch checked={manifold.installed} onChange={(installed) => set({ installed })} label="Manifold installed" />
      </label>
      <Group
        title="Outlets"
        note={`Each outlet holds an identical COPV (${copv.volumeL} L, target ${copv.targetBarg} barg, from the COPV card). The gas splits equally, so every COPV ends at the same pressure and temperature. The COPV counter and gas forecast count each one.`}
      >
        <NumberField
          className="col-span-2"
          label="COPVs filled together"
          value={manifold.outlets}
          onChange={(outlets) => set({ outlets: Math.round(outlets) })}
          min={2}
          max={50}
          digits={0}
        />
      </Group>
    </Modal>
  )
}
