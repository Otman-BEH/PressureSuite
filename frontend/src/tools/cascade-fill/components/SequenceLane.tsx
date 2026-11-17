import { useDndContext, useDroppable } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Fragment } from 'react'
import { fmt, fmtMin, MACHINES, sourceName, STATUS } from '../format'
import { currentBarg, parallelCount, useStore } from '../store'
import { SEQUENCE_ZONE, type DragData } from '../dnd'
import type { SequenceItem, Source, StepOut } from '../types'
import { ArrowRight, BoosterIcon, BundleIcon, ClockIcon, CompressorIcon, CooldownIcon, HeatExchangerIcon, ManifoldIcon, PlusIcon, XIcon } from './icons'
import { Chip, FluidChip, IconButton, NumberField, Panel, Stepper } from './ui'

const inlineSelect =
  'max-w-[7.5rem] truncate rounded bg-transparent px-0.5 text-xs font-medium text-sky-800 outline-none hover:bg-sky-50 focus:ring-2 focus:ring-sky-500'

/** "from <source> into <COPV|bundle> [until X barg]" on one line; most steps only show "into COPV". */
type Flow = Extract<SequenceItem, { type: 'source' | 'pump' | 'manifold' }>

function Route({ item }: { item: Flow }) {
  const sources = useStore((s) => s.sources)
  const fluid = useStore((s) => s.copv.fluid)
  const sequence = useStore((s) => s.sequence)
  const parallel = useStore((s) => parallelCount(s.manifold))
  const { setPumpSource, setStepTarget } = useStore.getState()
  const target = sources.find((s) => s.id === item.targetId)
  const pumpSteps = sequence.flatMap((it, i) => (it.type === 'pump' && it.uid !== item.uid ? [{ uid: it.uid, step: i + 1, name: MACHINES[it.machine].name, feedsUid: it.feedsUid }] : []))
  // a pump can discharge into another pump (in series), but not into one that feeds it
  const pumps = pumpSteps.filter((p) => p.feedsUid !== item.uid)
  const feeders = item.type === 'pump' ? pumpSteps.filter((p) => p.uid !== item.feedsUid) : []
  const manifolds = sequence.flatMap((it, i) => (it.type === 'manifold' ? [{ uid: it.uid, step: i + 1 }] : []))
  const own = item.type === 'manifold' ? item.sourceIds : [item.sourceId]
  const value = item.feedsUid ? `pump:${item.feedsUid}` : (item.targetId ?? '')
  const from = item.type === 'pump' ? (item.feedStepUid ? `step:${item.feedStepUid}` : (item.sourceId ?? '')) : '' 
  const choose = (v: string) =>
    v.startsWith('pump:') ? setStepTarget(item.uid, { feedsUid: v.slice(5) }) : setStepTarget(item.uid, { targetId: v || null, stopBarg: null })
  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-slate-500"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {item.type === 'pump' && (
        <>
          from
          <select aria-label="Feed from" value={from} onChange={(e) => setPumpSource(item.uid, e.target.value || null)} className={inlineSelect}>
            <option value="">pick a source…</option>
            {manifolds.map((m) => (
              <option key={m.uid} value={`step:${m.uid}`}>
                Manifold (step {m.step})
              </option>
            ))}
            {feeders.map((p) => (
              <option key={p.uid} value={`step:${p.uid}`}>
                {p.name} (step {p.step})
              </option>
            ))}
            {sources.map((s) => (
              <option key={s.id} value={s.id} disabled={s.fluid !== fluid}>
                {sourceName(s)}
              </option>
            ))}
          </select>
        </>
      )}
      into
      <select aria-label="Into" value={value} onChange={(e) => choose(e.target.value)} className={inlineSelect}>
        <option value="">{parallel > 1 ? `COPVs ×${parallel}` : 'COPV'}</option>
        {pumps.map((pm) => (
          <option key={pm.uid} value={`pump:${pm.uid}`}>
            {pm.name} (step {pm.step})
          </option>
        ))}
        {sources
          .filter((s) => !own.includes(s.id))
          .map((s) => (
            <option key={s.id} value={s.id} disabled={s.fluid !== fluid}>
              {sourceName(s)}
            </option>
          ))}
      </select>
      {target && (
        <>
          until
          <NumberField
            className="w-24"
            value={item.stopBarg ?? target.ratedBarg}
            onChange={(stopBarg) => setStepTarget(item.uid, { stopBarg })}
            min={0.1}
            max={target.ratedBarg}
            unit="barg"
            title={`Stop when ${target.label} reaches this pressure (rated ${fmt(target.ratedBarg, 0)} barg)`}
          />
        </>
      )}
    </div>
  )
}

/** Bundles opened together: stacked vertically, joined by a header bar. Drop inventory bundles here. */
function ManifoldMembers({ item }: { item: Extract<SequenceItem, { type: 'manifold' }> }) {
  const sources = useStore((s) => s.sources)
  const fluid = useStore((s) => s.copv.fluid)
  const { addToManifold, removeFromManifold, updateSource } = useStore.getState()
  const byId = new Map(sources.map((s) => [s.id, s]))
  const addable = sources.filter((s) => !item.sourceIds.includes(s.id) && s.fluid === fluid)
  return (
    <div className="mt-2 flex items-stretch" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex flex-1 flex-col gap-1">
        {item.sourceIds.map((id) => {
          const src = byId.get(id)
          return (
            <div key={id} className="flex items-center">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-1.5 py-1 text-xs ring-1 ring-slate-200">
                <BundleIcon className={`h-4 w-4 shrink-0 ${src?.fluid === 'Helium' ? 'text-violet-600' : 'text-sky-600'}`} />
                <span className="truncate font-medium text-slate-800">{src?.label ?? '?'}</span>
                {src && (
                  <Stepper
                    className="ml-auto"
                    value={src.quantity ?? 1}
                    onChange={(quantity) => updateSource(src.id, { quantity })}
                    title={`How many identical ${src.kind}s like ${src.label} are on the manifold (all at the same pressure)`}
                  />
                )}
                <span className="text-slate-500 tabular-nums">{src ? fmt(currentBarg(src), 0) : '–'}</span>
                <button
                  type="button"
                  aria-label={`Take ${src?.label} off the manifold`}
                  onClick={() => removeFromManifold(item.uid, id)}
                  className="text-slate-300 hover:text-rose-600"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
              <span className="h-0.5 w-2 shrink-0 bg-slate-400" aria-hidden="true" />
            </div>
          )
        })}
        {item.sourceIds.length < 2 && (
          <div className="rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-center text-[11px] text-slate-400">
            Drop bundles here (2 or more)
          </div>
        )}
        {addable.length > 0 && (
          <select
            aria-label="Add a bundle to the manifold"
            value=""
            onChange={(e) => e.target.value && addToManifold(item.uid, e.target.value)}
            className={`${inlineSelect} self-start`}
          >
            <option value="">+ add bundle</option>
            {addable.map((s) => (
              <option key={s.id} value={s.id}>
                {sourceName(s)}
              </option>
            ))}
          </select>
        )}
      </div>
      <span className="w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
    </div>
  )
}

function StepBody({ item, index, step, source }: { item: SequenceItem; index: number; step?: StepOut; source?: Source }) {
  const isothermal = useStore((s) => s.settings.mode === 'isothermal')
  const remove = () => useStore.getState().removeSequence(item.uid)
  const MachineIcon = item.type === 'pump' && item.machine === 'compressor' ? CompressorIcon : BoosterIcon
  const targetLabel = useStore((s) => (item.type !== 'cooldown' && item.targetId ? s.sources.find((x) => x.id === item.targetId)?.label : undefined))
  return (
    <>
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">{index + 1}</span>
          {item.type === 'cooldown' && (
            <span className="flex items-center gap-1 text-sm font-semibold text-cyan-800">
              <CooldownIcon className="size-4" /> Cool-down
            </span>
          )}
          {item.type === 'source' && <span className="truncate text-sm font-semibold text-slate-800">{source && sourceName(source)}</span>}
          {item.type === 'manifold' && (
            <span className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800">
              <ManifoldIcon className="size-4 shrink-0 -scale-x-100" /> Bundle manifold
            </span>
          )}
          {item.type === 'pump' && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useStore.getState().openEditor(item.machine)}
              title="Edit the machine's properties"
              className="flex items-center gap-1 truncate text-sm font-semibold text-amber-800 hover:underline"
            >
              <MachineIcon className="size-4 shrink-0" /> {MACHINES[item.machine].name}
            </button>
          )}
        </div>
        <IconButton label="Remove step" onClick={remove} className="hover:text-rose-600">
          <XIcon className="size-3.5" />
        </IconButton>
      </div>

      {item.type === 'manifold' && <ManifoldMembers item={item} />}
      {item.type !== 'cooldown' && (
        <div className="mt-1.5">
          <Route item={item} />
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600 tabular-nums">
        {item.type !== 'cooldown' && source && (
          <div className="flex items-center gap-1.5">
            <FluidChip fluid={source.fluid} />
            {step?.source_before && step.source_after ? (
              <span>
                <b className="text-slate-800">{fmt(step.source_before.pressure_barg)}</b> → <b className="text-slate-800">{fmt(step.source_after.pressure_barg)}</b> barg
              </span>
            ) : (
              <span>{fmt(currentBarg(source))} barg @ 20 °C</span>
            )}
          </div>
        )}
        {(item.type === 'manifold' || (item.type === 'pump' && item.feedStepUid)) && step?.source_before && step.source_after && step.delivered_kg > 0 && (
          <span>
            {item.type === 'manifold' ? 'Header' : 'Feed'} <b className="text-slate-800">{fmt(step.source_before.pressure_barg)}</b> → <b className="text-slate-800">{fmt(step.source_after.pressure_barg)}</b> barg
          </span>
        )}
        {item.type !== 'cooldown' && step?.source_after && !isothermal && step.delivered_kg > 0 && (
          <span>Source gas → {fmt(step.source_after.temp_c)} °C</span>
        )}
        {step && step.status !== 'feeds_pump' && (
          <span>
            {step.target_before && step.target_after ? (
              <>
                {targetLabel} {fmt(step.target_before.pressure_barg)} → <b className="text-slate-800">{fmt(step.target_after.pressure_barg)}</b> barg
                {!isothermal && <> · {fmt(step.target_after.temp_c)} °C gas</>}
              </>
            ) : (
              <>
                COPV {fmt(step.copv_before.pressure_barg)} → <b className="text-slate-800">{fmt(step.copv_after.pressure_barg)}</b> barg
                {!isothermal && <> · {fmt(step.copv_after.temp_c)} °C gas</>}
              </>
            )}
          </span>
        )}
        {step && step.delivered_kg > 0 && (
          <span>
            +{fmt(step.delivered_kg, 2)} kg into {step.target_after ? targetLabel : 'COPV'}
            {step.leaked_kg > 0 && <span className="text-slate-400"> ({fmt(step.leaked_kg, 2)} leaked)</span>}
          </span>
        )}
        {step && step.type === 'pump' && step.delivered_kg > 0 && (
          <span className="text-amber-800">
            Outlet gas ≤ {fmt(step.outlet_temp_max_c ?? 0)} °C · {fmt(step.energy_kwh, 2)} kWh
          </span>
        )}
        {step && step.hx_outlet_max_c !== null && step.delivered_kg > 0 && (
          <span className="text-teal-800">
            HX exit {fmt(step.hx_outlet_min_c ?? 0, 0)}
            {Math.abs((step.hx_outlet_max_c ?? 0) - (step.hx_outlet_min_c ?? 0)) >= 0.5 && <>–{fmt(step.hx_outlet_max_c, 0)}</>} °C ·{' '}
            {fmt(Math.abs(step.hx_duty_kwh), 3)} kWh {step.hx_duty_kwh >= 0 ? 'removed' : 'added'}
          </span>
        )}
        {step && step.duration_min !== null && (step.delivered_kg > 0 || step.type === 'cooldown') && (
          <span className="flex items-center gap-1 text-sky-800">
            <ClockIcon className="size-3.5" /> {fmtMin(step.duration_min)}
          </span>
        )}
      </div>

      {step && (
        <div className="mt-2" title={step.message}>
          <Chip className={STATUS[step.status].chip}>{STATUS[step.status].label}</Chip>
        </div>
      )}
    </>
  )
}

function SortableStep(props: { item: SequenceItem; index: number; step?: StepOut; source?: Source }) {
  const { item } = props
  const data: DragData = { origin: 'sequence', uid: item.uid }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: item.uid, data })
  const { active } = useDndContext()
  const external = active && (active.data.current as DragData | undefined)?.origin !== 'sequence'
  const dimmed = props.step && ['not_needed', 'no_flow', 'fluid_mismatch'].includes(props.step.status)
  const tone = {
    cooldown: 'bg-cyan-50/60 ring-cyan-200',
    pump: 'bg-amber-50/50 ring-amber-200',
    source: 'bg-white ring-slate-200',
    manifold: 'bg-slate-50 ring-slate-300',
  }[item.type]
  const joining = external && isOver && item.type === 'manifold' && (active?.data.current as DragData | undefined)?.origin === 'pool' 

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`relative w-56 shrink-0 cursor-grab rounded-xl p-3 ring-1 active:cursor-grabbing ${tone} ${isDragging ? 'z-10 opacity-40' : ''} ${
        dimmed ? 'opacity-60' : ''
      } ${joining ? 'ring-2 ring-sky-500' : ''} hover:ring-sky-400`}
    >
      {external && isOver && !joining && <div className="absolute top-2 bottom-2 -left-2.5 w-1 rounded-full bg-sky-500" aria-hidden="true" />}
      <StepBody {...props} />
    </div>
  )
}

/** The simulated steps for the sequence on screen (recovery steps follow them), or undefined if stale. */
export function matchSteps(sequence: SequenceItem[], steps: StepOut[] | undefined): StepOut[] | undefined {
  if (!steps || steps.length < sequence.length) return undefined
  const ok = sequence.every((it, i) => {
    const st = steps[i]
    if (it.type === 'manifold') return st.type === 'source' && (it.sourceIds[0] ?? null) === st.source_id
    if (it.type !== st.type) return false
    return it.type === 'cooldown' || (it.type === 'pump' && it.feedStepUid ? true : it.sourceId === st.source_id)
  })
  return ok ? steps : undefined
}

/** The COPV(s) at the end of the line: one capsule per COPV, filled to the settled pressure. */
function CopvNode({ count }: { count: number }) {
  const summary = useStore((s) => s.sim.result?.summary)
  const copv = useStore((s) => s.copv)
  const shown = Math.min(count, 4)
  const level = summary ? Math.min(1, Math.max(0, summary.copv_settled.pressure_barg / summary.target_barg)) : 0
  const color = copv.fluid === 'Helium' ? '#4a3aa7' : '#2a78d6'
  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-1 rounded-xl bg-white p-2 text-center text-[11px] text-slate-700 ring-2 ring-slate-800">
      <div className="flex items-end gap-1" aria-hidden="true">
        {Array.from({ length: shown }, (_, i) => (
          <svg key={i} viewBox="0 0 20 44" className="h-11 w-5">
            <rect x="1.5" y="1.5" width="17" height="41" rx="8.5" fill="#f1f5f9" stroke="#334155" strokeWidth="1.5" />
            <clipPath id={`copv-node-${i}`}>
              <rect x="1.5" y="1.5" width="17" height="41" rx="8.5" />
            </clipPath>
            <rect x="0" y={43 - 41 * level} width="20" height={41 * level} fill={color} opacity="0.85" clipPath={`url(#copv-node-${i})`} />
          </svg>
        ))}
        {count > shown && <span className="pb-1 text-slate-500">+{count - shown}</span>}
      </div>
      <span className="font-semibold">{count > 1 ? `${count} COPVs` : 'COPV'}</span>
      <span className="tabular-nums">
        {summary ? `${fmt(summary.copv_settled.pressure_barg)} / ${fmt(copv.targetBarg, 0)} barg` : `target ${fmt(copv.targetBarg, 0)} barg`}
      </span>
    </div>
  )
}

export function SequenceLane() {
  const sequence = useStore((s) => s.sequence)
  const sources = useStore((s) => s.sources)
  const result = useStore((s) => s.sim.result)
  const loading = useStore((s) => s.sim.loading)
  const hx = useStore((s) => s.heatExchanger)
  const manifold = useStore((s) => s.manifold)
  const isothermal = useStore((s) => s.settings.mode === 'isothermal')
  const { setNodeRef, isOver } = useDroppable({ id: SEQUENCE_ZONE })
  const { active } = useDndContext()
  const accepting = active && (active.data.current as DragData | undefined)?.origin !== 'sequence'
  const byId = new Map(sources.map((s) => [s.id, s]))
  const steps = matchSteps(sequence, result?.steps)

  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-center gap-2">
          Fill sequence
          {loading && <span className="text-xs font-normal text-slate-400">simulating…</span>}
        </span>
      }
      aside={
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">Connected left to right, into the COPV. Drag to reorder.</span>
          {sequence.length > 0 && (
            <button type="button" onClick={() => useStore.getState().clearSequence()} className="text-xs text-slate-500 hover:text-rose-600">
              Clear
            </button>
          )}
        </div>
      }
    >
      <div
        ref={setNodeRef}
        className={`flex min-h-40 items-center gap-1 overflow-x-auto rounded-lg p-2 transition-colors ${
          accepting ? (isOver ? 'bg-sky-50 outline-2 outline-sky-400' : 'outline-2 outline-dashed outline-sky-300') : ''
        }`}
      >
        <SortableContext items={sequence.map((s) => s.uid)} strategy={horizontalListSortingStrategy}>
          {sequence.map((item, i) => (
            <Fragment key={item.uid}>
              <SortableStep
                item={item}
                index={i}
                step={steps?.[i]}
                source={(item.type === 'source' || item.type === 'pump') && item.sourceId ? byId.get(item.sourceId) : undefined}
              />
              <ArrowRight className="size-5 shrink-0 text-slate-300" />
            </Fragment>
          ))}
        </SortableContext>
        {sequence.length ? (
          <div
            className="grid h-32 w-10 shrink-0 place-items-center rounded-xl border-2 border-dashed border-slate-200 text-slate-300"
            title="Drop here to add a step at the end"
          >
            <PlusIcon className="size-4" />
          </div>
        ) : (
          <div className="grid h-32 w-44 shrink-0 place-items-center rounded-xl border-2 border-dashed border-slate-200 px-3 text-center text-xs text-slate-400">
            Drag sources, equipment or a cool-down here to build the sequence
          </div>
        )}
        {hx.installed && (
          <>
            <ArrowRight className="size-5 shrink-0 text-slate-300" />
            <button
              type="button"
              onClick={() => useStore.getState().openEditor('hx')}
              title="Heat exchanger in the fill line: every fill step passes through it"
              className="flex w-28 shrink-0 flex-col items-center gap-1 rounded-xl bg-teal-50 p-2 text-center text-[11px] text-teal-900 ring-1 ring-teal-200 hover:ring-teal-400"
            >
              <HeatExchangerIcon className="size-7 text-teal-600" />
              <span className="font-semibold">Heat exchanger</span>
              <span>
                {hx.control === 'outlet_temp' ? `exit ${fmt(hx.outletTempC)} °C` : `${fmt(hx.effectivenessPct, 0)} % · ${fmt(hx.coolantTempC)} °C`}
              </span>
              {isothermal && <span className="text-amber-700">no effect (isothermal)</span>}
            </button>
          </>
        )}
        {manifold.installed && (
          <>
            <ArrowRight className="size-5 shrink-0 text-slate-300" />
            <button
              type="button"
              onClick={() => useStore.getState().openEditor('manifold')}
              title="Manifold: the gas splits equally between the COPVs"
              className="flex w-24 shrink-0 flex-col items-center gap-1 rounded-xl bg-slate-50 p-2 text-center text-[11px] text-slate-700 ring-1 ring-slate-300 hover:ring-slate-500"
            >
              <ManifoldIcon className="size-7 text-slate-700" />
              <span className="font-semibold">Manifold</span>
              <span>split ÷ {parallelCount(manifold)}</span>
            </button>
          </>
        )}
        <ArrowRight className="size-5 shrink-0 text-slate-300" />
        <CopvNode count={parallelCount(manifold)} />
      </div>
    </Panel>
  )
}
