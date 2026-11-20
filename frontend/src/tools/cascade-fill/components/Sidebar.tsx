import { useDraggable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { FLUID_DEFAULT_PRESSURE, FLUIDS, fmt, MACHINES } from '../format'
import { copvsDone, defaultPumpSource, useStore } from '../store'
import type { EditorKind, HistoryEntry } from '../types'
import { isMachine, type DragData, type TemplateKind } from '../dnd'
import { BoosterIcon, BottleIcon, BundleIcon, CompressorIcon, CooldownIcon, HeatExchangerIcon, ManifoldIcon, PlusIcon } from './icons'
import { Button, Panel, Switch } from '../../../shared/ui'

export function TemplateVisual({ kind }: { kind: TemplateKind }) {
  const fluid = useStore((s) => s.copv.fluid)
  const equipment = useStore((s) => s.equipment)
  const p = FLUID_DEFAULT_PRESSURE[fluid]
  const machineDetail = (k: 'booster' | 'compressor') =>
    `In ${fmt(equipment[k].inletMinBarg, 0)}–${fmt(equipment[k].inletMaxBarg, 0)} → out ≤ ${fmt(equipment[k].outletMaxBarg, 0)} barg`
  const info = {
    bundle: { title: 'Bundle', detail: `12 × 50 L · ${FLUIDS[fluid].short} ${p} barg`, icon: <BundleIcon className="h-9 w-9 text-muted" /> },
    bottle: { title: 'Single bottle', detail: `50 L · ${FLUIDS[fluid].short} ${p} barg`, icon: <BottleIcon className="h-9 w-6 text-muted" /> },
    cooldown: { title: 'Cool-down', detail: 'Wait until everything is back at ambient', icon: <CooldownIcon className="size-7 text-ink" /> },
    bundle_manifold: {
      title: 'Bundle manifold',
      detail: 'Open several bundles together as one source',
      icon: <ManifoldIcon className="size-8 -scale-x-100 text-ink" />,
    },
    booster: { title: MACHINES.booster.name, detail: machineDetail('booster'), icon: <BoosterIcon className="size-8 text-ink" /> },
    compressor: { title: MACHINES.compressor.name, detail: machineDetail('compressor'), icon: <CompressorIcon className="size-8 text-warn-ink" /> },
  }[kind]
  return (
    <div className="flex items-center gap-3">
      <div className="grid w-9 place-items-center">{info.icon}</div>
      <div className="min-w-0">
        <div className="text-body font-medium text-ink">{info.title}</div>
        <div className="text-small text-muted">{info.detail}</div>
      </div>
    </div>
  )
}

function TemplateTile({ kind }: { kind: TemplateKind }) {
  const data: DragData = { origin: 'template', kind }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tpl:${kind}`, data })
  const machine = isMachine(kind)
  const add = () => {
    const s = useStore.getState()
    if (kind === 'cooldown') s.insertSequence({ type: 'cooldown' })
    else if (kind === 'bundle_manifold') s.insertSequence({ type: 'manifold', sourceIds: [] })
    else if (isMachine(kind))
      s.insertSequence({ type: 'pump', machine: kind, sourceId: defaultPumpSource(s.sources, s.copv.fluid, s.equipment[kind]) })
    else s.addSource(kind)
  }
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={machine ? () => useStore.getState().openEditor(kind) : undefined}
      title={machine ? 'Click to edit its properties, drag into the sequence to use it' : undefined}
      className={`group flex cursor-grab items-center justify-between gap-2 border-b border-rule px-3 py-2 last:border-b-0 hover:bg-inset active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <TemplateVisual kind={kind} />
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            add()
          }}
          title={kind === 'bundle' || kind === 'bottle' ? 'Add to the gas inventory' : 'Append to the fill sequence'}
          aria-label={kind === 'bundle' || kind === 'bottle' ? `Add ${kind} to inventory` : `Append ${kind} to sequence`}
          className="grid size-7 place-items-center rounded-control text-muted ring-1 ring-rule hover:bg-accent-tint hover:text-accent"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** Fixed fill-line hardware: switched in or out, click to edit. */
function SwitchTile({ editor, icon, title, detail, installed, onToggle }: {
  editor: EditorKind
  icon: ReactNode
  title: string
  detail: string
  installed: boolean
  onToggle: (on: boolean) => void
}) {
  const openEditor = useStore.getState().openEditor
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openEditor(editor)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openEditor(editor)}
      title="Click to edit its properties"
      className="group flex cursor-pointer items-center justify-between gap-2 border-b border-rule px-3 py-2 last:border-b-0 hover:bg-inset"
    >
      <div className="flex items-center gap-3">
        <div className={`grid w-9 place-items-center ${installed ? '' : 'opacity-50'}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">{title}</div>
          <div className="text-small text-muted">{detail}</div>
        </div>
      </div>
      <Switch checked={installed} onChange={onToggle} label={`${title} installed`} />
    </div>
  )
}

function HeatExchangerTile() {
  const hx = useStore((s) => s.heatExchanger)
  const detail = hx.control === 'outlet_temp' ? `Gas exits at ${fmt(hx.outletTempC)} °C` : `${fmt(hx.effectivenessPct, 0)} % vs ${fmt(hx.coolantTempC)} °C coolant`
  return (
    <SwitchTile
      editor="hx"
      icon={<HeatExchangerIcon className="size-8 text-ink" />}
      title="Heat exchanger"
      detail={hx.installed ? detail : 'Not in the fill line'}
      installed={hx.installed}
      onToggle={(installed) => useStore.getState().setHeatExchanger({ installed })}
    />
  )
}

function ManifoldTile() {
  const manifold = useStore((s) => s.manifold)
  return (
    <SwitchTile
      editor="manifold"
      icon={<ManifoldIcon className="size-8 text-ink" />}
      title="Manifold"
      detail={manifold.installed ? `${manifold.outlets} COPVs filled in parallel` : 'One COPV at a time'}
      installed={manifold.installed}
      onToggle={(installed) => useStore.getState().setManifold({ installed })}
    />
  )
}

/** "COPV #3" or "COPVs #3–4" for history entry i (newest first). */
function historyLabel(history: HistoryEntry[], i: number): string {
  const first = copvsDone(history.slice(i + 1)) + 1
  const last = first + (history[i].copvs ?? 1) - 1
  return last > first ? `COPVs #${first}–${last}` : `COPV #${first}`
}

function FillHistory() {
  const history = useStore((s) => s.history)
  const undo = useStore((s) => s.undoLastFill)
  if (!history.length)
    return <p className="text-small text-muted">Completed fills appear here. Use “Fill next COPV” in the results to carry the leftover gas into the next fill.</p>
  return (
    <ol className="flex flex-col gap-2">
      {history.map((h, i) => (
        <li key={h.id} className="bg-inset p-2.5 text-small ring-1 ring-rule">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-ink">{historyLabel(history, i)}</span>
            {i === 0 && (
              <Button variant="quiet" onClick={undo}>
                Undo
              </Button>
            )}
          </div>
          <div className="mt-1 text-muted tabular-nums">
            {fmt(h.settledBarg)} / {fmt(h.targetBarg, 0)} barg settled {h.reached ? '✓' : '(short)'}
          </div>
          <div className="text-muted">
            {FLUIDS[h.fluid].short} · {fmt(h.deliveredKg, 2)} kg
          </div>
          <div className="mt-1 truncate text-muted" title={h.steps.join(' → ')}>
            {h.steps.join(' → ')}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Sidebar() {
  return (
    <>
      <Panel title={<span title="Drag into the gas inventory, or straight into the fill sequence.">Components</span>}>
        <div className="-m-3 flex flex-col">
          <TemplateTile kind="bundle" />
          <TemplateTile kind="bottle" />
          <TemplateTile kind="bundle_manifold" />
          <TemplateTile kind="cooldown" />
        </div>
      </Panel>
      <Panel title={<span title="Click to edit. Drag a pump into the sequence; switch the rest in or out.">Equipment</span>}>
        <div className="-m-3 flex flex-col">
          <TemplateTile kind="booster" />
          <TemplateTile kind="compressor" />
          <HeatExchangerTile />
          <ManifoldTile />
        </div>
      </Panel>
      <Panel title="Fill history">
        <FillHistory />
      </Panel>
    </>
  )
}
