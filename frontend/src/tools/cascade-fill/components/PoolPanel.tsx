import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core'
import { useState } from 'react'
import { describeSize, fmt, SOURCE_REF_TEMP_C } from '../format'
import { currentBarg, useStore } from '../store'
import { POOL_ZONE, type DragData } from '../dnd'
import type { Fluid, Source } from '../types'
import { ArrowRight, BottleIcon, BundleIcon, PencilIcon, TrashIcon } from './icons'
import { Button, IconButton, Lamp, NumberField, Panel, Segmented, Stepper, TextField } from '../../../shared/ui'
import { FluidChip } from './ui'

export function SourceVisual({ source }: { source: Source }) {
  const Icon = source.kind === 'bundle' ? BundleIcon : BottleIcon
  const now = currentBarg(source)
  const level = Math.min(1, now / Math.max(source.ratedBarg, 1e-9))
  return (
    <div className="flex items-start gap-3">
      <Icon className={`${source.kind === 'bundle' ? 'h-10 w-10' : 'h-10 w-6'} shrink-0 text-ink`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-semibold text-ink">{source.label}</span>
          <FluidChip fluid={source.fluid} />
        </div>
        <div className="text-small text-muted">{describeSize(source)}</div>
        <div className="mt-0.5 text-base font-semibold text-ink tabular-nums">
          {fmt(now)}{' '}
          <span className="text-small font-normal text-muted">
            / {fmt(source.ratedBarg, 0)} barg
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden bg-bg" title={`${fmt(level * 100, 0)} % of rated pressure`}>
          <div className={`h-full bg-muted`} style={{ width: `${level * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

/** "Filled" tick box; unticked, the current pressure can be typed in place. */
function FillState({ source }: { source: Source }) {
  const update = (patch: Partial<Source>) => useStore.getState().updateSource(source.id, patch)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-small text-ink" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={source.filled} onChange={(e) => update({ filled: e.target.checked })} />
        Filled
      </label>
      {!source.filled && (
        <NumberField
          className="w-24"
          value={source.pressureBarg}
          onChange={(pressureBarg) => update({ pressureBarg })}
          min={0}
          max={source.ratedBarg}
          unit="barg"
          title={`Current pressure at ${SOURCE_REF_TEMP_C} °C`}
        />
      )}
      <Stepper
        className="ml-auto"
        value={source.quantity ?? 1}
        onChange={(quantity) => update({ quantity })}
        title={`Identical ${source.kind}s: this card stands for that many, always at the same pressure and opened together`}
      />
    </div>
  )
}

function SourceEditor({ source }: { source: Source }) {
  const update = (patch: Partial<Source>) => useStore.getState().updateSource(source.id, patch)
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-rule pt-3" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <TextField className="col-span-2" label="Name" value={source.label} onChange={(label) => update({ label })} />
      <div className="col-span-2 flex flex-col gap-1">
        <span className="text-label font-medium text-muted uppercase">Gas</span>
        <Segmented<Fluid>
          label="Gas"
          value={source.fluid}
          onChange={(fluid) => update({ fluid })}
          options={[
            { value: 'Nitrogen', label: 'Nitrogen' },
            { value: 'Helium', label: 'Helium' },
          ]}
        />
      </div>
      <NumberField
        className="col-span-2"
        label={`Rated (max) pressure, at ${SOURCE_REF_TEMP_C} °C`}
        value={source.ratedBarg}
        onChange={(ratedBarg) => update({ ratedBarg })}
        min={1}
        max={1000}
        unit="barg"
        title="Full pressure of this bundle; filling it (pump, valve or recovery) stops here"
      />
      {source.kind === 'bundle' && (
        <NumberField label="Cylinders" value={source.cylinderCount} onChange={(n) => update({ cylinderCount: Math.round(n) })} min={1} max={500} digits={0} />
      )}
      <NumberField
        className={source.kind === 'bundle' ? '' : 'col-span-2'}
        label={source.kind === 'bundle' ? 'Volume per cylinder' : 'Water volume'}
        value={source.cylinderVolumeL}
        onChange={(cylinderVolumeL) => update({ cylinderVolumeL })}
        min={0.1}
        max={10000}
        unit="L"
      />
    </div>
  )
}

function SourceCard({ source }: { source: Source }) {
  const [editing, setEditing] = useState(false)
  const view = useStore((s) => s.view)
  const copvFluid = useStore((s) => s.copv.fluid)
  const ambient = useStore((s) => s.settings.ambientTempC)
  const mode = useStore((s) => s.settings.mode)
  const excluded = useStore((s) => s.excluded.includes(source.id))
  const uses = useStore(
    (s) => s.sequence.filter((it) => (it.type === 'manifold' ? it.sourceIds.includes(source.id) : it.type !== 'cooldown' && it.sourceId === source.id)).length,
  )
  const isRecovery = useStore((s) => s.afterTest.action === 'recover' && s.afterTest.vesselId === source.id)
  const result = useStore((s) => (s.view === 'manual' ? s.sim.result?.sources.find((r) => r.id === source.id) : undefined))
  const data: DragData = { origin: 'pool', sourceId: source.id }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool:${source.id}`, data })
  const wrongGas = source.fluid !== copvFluid
  const { insertSequence, removeSource, toggleExcluded } = useStore.getState()

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`w-64 shrink-0 cursor-grab border-r border-rule p-3 hover:bg-inset active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      } ${wrongGas || (view === 'optimize' && excluded) ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <SourceVisual source={source} />
        <div className="flex shrink-0">
          <IconButton label={editing ? 'Close editor' : 'Edit source'} onClick={() => setEditing(!editing)}>
            <PencilIcon className="size-3.5" />
          </IconButton>
          <IconButton label="Delete source" onClick={() => removeSource(source.id)} className="hover:text-crit">
            <TrashIcon className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <FillState source={source} />

      <div className="mt-2 flex flex-col gap-0.5 text-small text-muted">
        {ambient !== SOURCE_REF_TEMP_C && result && (
          <span className="tabular-nums">
            At {fmt(ambient)} °C: {fmt(result.start.pressure_barg)} barg
          </span>
        )}
        {result && (result.connections > 0 || Math.abs(result.used_kg) > 1e-6) && (
          <span
            className="text-ink tabular-nums"
            title={mode !== 'isothermal' ? `End of fill ${fmt(result.end.pressure_barg)} barg at ${fmt(result.end.temp_c)} °C gas` : undefined}
          >
            After this fill → <b>{fmt(result.settled_barg)} barg</b>
          </span>
        )}
        {wrongGas && <Lamp status="crit">Not the COPV gas: ignored</Lamp>}
        {isRecovery && <Lamp status="idle">Recovery bundle</Lamp>}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {view === 'manual' ? (
          <Button
            variant="secondary"
            onClick={() => insertSequence({ type: 'source', sourceId: source.id })}
          >
            Add to sequence <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <label className="inline-flex items-center gap-1.5 text-small text-ink" onPointerDown={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={!excluded && !wrongGas} disabled={wrongGas} onChange={() => toggleExcluded(source.id)} />
            Use in optimizer
          </label>
        )}
        {view === 'manual' && uses > 0 && <span className="text-small whitespace-nowrap text-muted">in sequence {uses}×</span>}
      </div>

      {editing && <SourceEditor source={source} />}
    </div>
  )
}

export function PoolPanel() {
  const sources = useStore((s) => s.sources)
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ZONE })
  const { active } = useDndContext()
  const origin = (active?.data.current as DragData | undefined)?.origin
  const kind = (active?.data.current as { kind?: string } | undefined)?.kind
  const accepting = origin === 'sequence' || (origin === 'template' && (kind === 'bundle' || kind === 'bottle'))

  return (
    <Panel
      title={
        <>
          Gas inventory <span className="font-normal text-muted">· {sources.length} sources</span>
        </>
      }
      aside={accepting && origin === 'sequence' && <span className="text-small text-muted">Drop the step here to remove it</span>}
    >
      <div
        ref={setNodeRef}
        className={`-m-3 flex min-h-32 overflow-x-auto transition-colors ${
          accepting ? (isOver ? 'bg-accent-tint outline-2 outline-accent' : 'outline-2 outline-dashed outline-accent') : ''
        }`}
      >
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} />
        ))}
        {!sources.length && (
          <div className="m-3 grid flex-1 place-items-center border-2 border-dashed border-rule text-body text-muted">
            Drag a bundle or bottle here
          </div>
        )}
      </div>
    </Panel>
  )
}
