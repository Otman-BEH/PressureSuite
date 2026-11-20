import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useState } from 'react'
import { ToolLayout } from '../../shared/ToolLayout'
import { api, equipmentPayload, scenarioPayload } from './api'
import { CampaignPanel } from './components/CampaignPanel'
import { CopvCard } from './components/CopvCard'
import { CooldownIcon } from './components/icons'
import { Editors } from './components/Editors'
import { OptimizerPanel } from './components/OptimizerPanel'
import { PoolPanel, SourceVisual } from './components/PoolPanel'
import { ResultsPanel } from './components/ResultsPanel'
import { SequenceLane } from './components/SequenceLane'
import { Sidebar, TemplateVisual } from './components/Sidebar'
import { CascadeControls, CascadeFileActions } from './components/TopBar'
import { collisionDetection, POOL_ZONE, SEQUENCE_ZONE, type DragData } from './dnd'
import { defaultPumpSource, parallelCount, useStore } from './store'

/** Re-simulates the manual sequence shortly after any input changes. */
function useAutoSimulate() {
  const settings = useStore((s) => s.settings)
  const copv = useStore((s) => s.copv)
  const sources = useStore((s) => s.sources)
  const sequence = useStore((s) => s.sequence)
  const equipment = useStore((s) => s.equipment)
  const heatExchanger = useStore((s) => s.heatExchanger)
  const afterTest = useStore((s) => s.afterTest)
  const timeModel = useStore((s) => s.timeModel)
  const manifold = useStore((s) => s.manifold)
  const view = useStore((s) => s.view)

  useEffect(() => {
    if (view !== 'manual') return
    const { setSim } = useStore.getState()
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSim({ loading: true })
      try {
        const payload = scenarioPayload(settings, copv, sources, parallelCount(manifold))
        const result = await api.simulate(payload, equipmentPayload({ equipment, heatExchanger, afterTest, timeModel }), sequence, controller.signal)
        setSim({ result, loading: false, error: null })
      } catch (e) {
        if (!controller.signal.aborted) setSim({ loading: false, error: (e as Error).message })
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [settings, copv, sources, sequence, equipment, heatExchanger, afterTest, timeModel, manifold, view])
}

function DragPreview({ data }: { data: DragData }) {
  const sources = useStore((s) => s.sources)
  const sequence = useStore((s) => s.sequence)
  let body
  if (data.origin === 'template') body = <TemplateVisual kind={data.kind} />
  else {
    const item = data.origin === 'sequence' ? sequence.find((s) => s.uid === data.uid) : undefined
    if (item?.type === 'pump') body = <TemplateVisual kind={item.machine} />
    else if (item?.type === 'manifold') body = <TemplateVisual kind="bundle_manifold" />
    else {
      const sourceId = data.origin === 'pool' ? data.sourceId : item?.type === 'source' ? item.sourceId : undefined
      const source = sources.find((s) => s.id === sourceId)
      body = source ? (
        <SourceVisual source={source} />
      ) : (
        <span className="flex items-center gap-1 text-body font-semibold text-ink">
          <CooldownIcon className="size-4" /> Cool-down
        </span>
      )
    }
  }
  return <div className="w-60 cursor-grabbing bg-inset p-3 shadow-raised ring-1 ring-accent">{body}</div>
}

/** The COPV Fill tool (cascade fill method): inventory, fill sequence, optimizer, campaign and results. */
export function CascadeFillTool() {
  useAutoSimulate()
  const view = useStore((s) => s.view)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as DragData) ?? null)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const data = active.data.current as DragData | undefined
    if (!data || !over) return
    const store = useStore.getState()
    const overId = String(over.id)
    const overIndex = store.sequence.findIndex((s) => s.uid === overId)
    const toSequence = overId === SEQUENCE_ZONE || overIndex >= 0
    const toPool = overId === POOL_ZONE
    const at = overIndex >= 0 ? overIndex : undefined

    if (data.origin === 'template') {
      const kind = data.kind
      if (kind === 'cooldown') {
        if (toSequence) store.insertSequence({ type: 'cooldown' }, at)
      } else if (kind === 'bundle_manifold') {
        if (toSequence) store.insertSequence({ type: 'manifold', sourceIds: [] }, at)
      } else if (kind === 'booster' || kind === 'compressor') {
        const sourceId = defaultPumpSource(store.sources, store.copv.fluid, store.equipment[kind])
        if (toSequence) store.insertSequence({ type: 'pump', machine: kind, sourceId }, at)
      } else if (toPool) {
        store.addSource(kind)
      } else if (toSequence) {
        store.insertSequence({ type: 'source', sourceId: store.addSource(kind) }, at)
      }
    } else if (data.origin === 'pool') {
      const onto = overIndex >= 0 ? store.sequence[overIndex] : undefined
      if (onto?.type === 'manifold') store.addToManifold(onto.uid, data.sourceId)  // dropped onto a bundle manifold
      else if (toSequence) store.insertSequence({ type: 'source', sourceId: data.sourceId }, at)
    } else if (toPool) {
      store.removeSequence(data.uid)
    } else if (overIndex >= 0 && overId !== data.uid) {
      store.moveSequence(store.sequence.findIndex((s) => s.uid === data.uid), overIndex)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <ToolLayout name="COPV Fill" controls={<CascadeControls />} actions={<CascadeFileActions />} inputs={<Sidebar />}>
        <PoolPanel />
        <div className="flex flex-col 2xl:flex-row 2xl:items-stretch">
          <div className="min-w-0 flex-1 2xl:border-b 2xl:border-rule 2xl:bg-surface 2xl:[&>section]:border-b-0">{view === 'manual' ? <SequenceLane /> : <OptimizerPanel />}</div>
          <CopvCard />
        </div>
        <CampaignPanel />
        {view === 'manual' && <ResultsPanel />}
      </ToolLayout>
      <Editors />
      <DragOverlay dropAnimation={null}>{dragging && <DragPreview data={dragging} />}</DragOverlay>
    </DndContext>
  )
}
