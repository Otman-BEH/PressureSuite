import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { DEFAULT_HX, DEFAULT_MACHINES, DEFAULT_TIME, FLUID_DEFAULT_PRESSURE, MACHINES, sourceName, uid } from './format'
import type {
  ApiSequenceItem,
  CampaignResponse,
  Copv,
  Fluid,
  HistoryEntry,
  MachineKind,
  MachineSpec,
  OptimizeResponse,
  AfterTest,
  EditorKind,
  HeatExchanger,
  Manifold,
  TimeModel,
  SequenceItem,
  Settings,
  SimulateResponse,
  Source,
  SourceKind,
  View,
} from './types'

// Saved state lives under a per-tool key. Older builds used 'copv-cascade-fill'; carry that over once.
const STORAGE_KEY = 'pressuresuite:cascade-fill'
const LEGACY_STORAGE_KEY = 'copv-cascade-fill'
try {
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy !== null && localStorage.getItem(STORAGE_KEY) === null) localStorage.setItem(STORAGE_KEY, legacy)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
} catch {
  /* storage unavailable: nothing to migrate */
}

// localStorage can be missing or throw (private windows, blocked storage); the app works without it.
const safeStorage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* not persisted */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing to remove */
    }
  },
}

export interface Scenario {
  settings: Settings
  copv: Copv
  sources: Source[]
  sequence: SequenceItem[]
  equipment: Record<MachineKind, MachineSpec>
  afterTest: AfterTest
  heatExchanger: HeatExchanger
  manifold: Manifold
  timeModel: TimeModel
  copvCount: number
}

interface AsyncSlot<T> {
  result: T | null
  loading: boolean
  error: string | null
}

type Keyed<T> = AsyncSlot<T> & { inputKey: string | null }

type NewSequenceItem =
  | { type: 'source'; sourceId: string }
  | { type: 'cooldown' }
  | { type: 'pump'; machine: MachineKind; sourceId: string | null }
  | { type: 'manifold'; sourceIds: string[] }

interface AppState extends Scenario {
  view: View
  minGainBar: number
  maxCooldowns: number
  excluded: string[]
  history: HistoryEntry[]
  counters: Record<SourceKind, number>
  editing: EditorKind | null
  sim: AsyncSlot<SimulateResponse>
  opt: Keyed<OptimizeResponse>
  campaign: Keyed<CampaignResponse>

  setAmbient: (c: number) => void
  setMode: (mode: Settings['mode']) => void
  setView: (view: View) => void
  setCopv: (patch: Partial<Copv>) => void
  setCopvCount: (n: number) => void
  setMinGain: (bar: number) => void
  setMaxCooldowns: (n: number) => void
  setMachine: (kind: MachineKind, patch: Partial<MachineSpec>) => void
  resetMachine: (kind: MachineKind) => void
  openEditor: (kind: EditorKind | null) => void
  setAfterTest: (patch: Partial<AfterTest>) => void
  setHeatExchanger: (patch: Partial<HeatExchanger>) => void
  setManifold: (patch: Partial<Manifold>) => void
  setTimeModel: (patch: Partial<TimeModel>) => void
  addSource: (kind: SourceKind) => string
  updateSource: (id: string, patch: Partial<Source>) => void
  removeSource: (id: string) => void
  toggleExcluded: (id: string) => void
  insertSequence: (item: NewSequenceItem, index?: number) => void
  /** A bundle id, or "step:<uid>" to draw from a bundle-manifold step. */
  setPumpSource: (uid: string, source: string | null) => void
  addToManifold: (uid: string, sourceId: string) => void
  removeFromManifold: (uid: string, sourceId: string) => void
  setStepTarget: (uid: string, patch: { targetId?: string | null; stopBarg?: number | null; feedsUid?: string | null }) => void
  moveSequence: (from: number, to: number) => void
  removeSequence: (uid: string) => void
  clearSequence: () => void
  applyPlan: (plan: ApiSequenceItem[]) => void
  commitFill: () => void
  undoLastFill: () => void
  newCampaign: () => void
  importScenario: (data: Partial<Scenario> & { history?: HistoryEntry[] }) => void
  resetAll: () => void
  setSim: (patch: Partial<AsyncSlot<SimulateResponse>>) => void
  setOpt: (patch: Partial<Keyed<OptimizeResponse>>) => void
  setCampaign: (patch: Partial<Keyed<CampaignResponse>>) => void
}

const DEFAULT_COPV: Copv = {
  fluid: 'Nitrogen',
  volumeL: 50,
  targetBarg: 180,
  initialBarg: 0,
  wallMassKg: 25,
  wallCpJkgK: 900,
  leakPct: 1,
}

function makeSource(kind: SourceKind, n: number, fluid: Fluid, pressureBarg = FLUID_DEFAULT_PRESSURE[fluid]): Source {
  const ratedBarg = Math.max(FLUID_DEFAULT_PRESSURE[fluid], pressureBarg)
  return {
    id: uid(),
    kind,
    label: `${kind === 'bundle' ? 'Bundle' : 'Bottle'} ${n}`,
    fluid,
    pressureBarg,
    ratedBarg,
    filled: pressureBarg >= ratedBarg,
    cylinderVolumeL: 50,
    cylinderCount: kind === 'bundle' ? 12 : 1,
    quantity: 1,
  }
}

function initialScenario() {
  const b1 = makeSource('bundle', 1, 'Nitrogen', 150)
  const b2 = makeSource('bundle', 2, 'Nitrogen', 300)
  const bottle = makeSource('bottle', 1, 'Nitrogen', 300)
  return {
    settings: { ambientTempC: 20, mode: 'isothermal' as const },
    copv: DEFAULT_COPV,
    sources: [b1, b2, bottle],
    sequence: [
      { uid: uid(), type: 'source' as const, sourceId: b1.id },
      { uid: uid(), type: 'source' as const, sourceId: b2.id },
    ],
    equipment: DEFAULT_MACHINES,
    afterTest: DEFAULT_AFTER_TEST,
    heatExchanger: DEFAULT_HX,
    manifold: DEFAULT_MANIFOLD,
    timeModel: DEFAULT_TIME,
    copvCount: 5,
    counters: { bundle: 2, bottle: 1 },
    history: [] as HistoryEntry[],
    excluded: [] as string[],
  }
}

/** The pressure a source holds now (its rated pressure when ticked as filled). */
export const currentBarg = (s: Source) => (s.filled ? s.ratedBarg : s.pressureBarg)

/** Older saves lack newer fields: no rated pressure (assume the gas default, or the current pressure if higher), no quantity. */
function upgradeSource(s: Source): Source {
  const quantity = s.quantity ?? 1
  if (typeof s.ratedBarg === 'number' && typeof s.filled === 'boolean') return { ...s, quantity }
  const ratedBarg = Math.max(FLUID_DEFAULT_PRESSURE[s.fluid] ?? 300, s.pressureBarg)
  return { ...s, ratedBarg, filled: s.pressureBarg >= ratedBarg, quantity }
}

/** Lowest-pressure source of the COPV gas the machine can draw from (falls back to the lowest one). */
export function defaultPumpSource(sources: Source[], fluid: Fluid, spec: MachineSpec): string | null {
  const usable = sources.filter((s) => s.fluid === fluid).sort((a, b) => currentBarg(a) - currentBarg(b))
  return (usable.find((s) => currentBarg(s) > spec.inletMinBarg) ?? usable[0])?.id ?? null
}

export function sequenceLabel(item: SequenceItem, labels: Map<string, string>, sequence: SequenceItem[] = []): string {
  if (item.type === 'cooldown') return 'Cool-down'
  const fed = item.feedsUid ? sequence.find((it) => it.uid === item.feedsUid) : undefined
  const into = fed?.type === 'pump' ? ` → ${MACHINES[fed.machine].name}` : item.targetId ? ` → ${labels.get(item.targetId) ?? '?'}` : ''
  if (item.type === 'manifold') return `Manifold (${item.sourceIds.map((id) => labels.get(id) ?? '?').join(' + ')})${into}`
  const feed = item.type === 'pump' && item.feedStepUid ? sequence.find((it) => it.uid === item.feedStepUid) : undefined
  const source = feed ? (feed.type === 'pump' ? MACHINES[feed.machine].name : 'manifold') : item.sourceId ? (labels.get(item.sourceId) ?? '?') : 'no source'
  return item.type === 'pump' ? `${MACHINES[item.machine].name}: ${source}${into}` : `${source}${into}`
}

const DEFAULT_AFTER_TEST: AfterTest = { action: 'none', vesselId: null, ventToBarg: 0 }

/** Version-2 saves stored gas recovery as `recovery: { enabled, vesselId }`. */
function legacyAfterTest(persisted: unknown): Partial<AfterTest> {
  const r = (persisted as { recovery?: { enabled?: boolean; vesselId?: string | null } } | null)?.recovery
  return r?.enabled ? { action: 'recover', vesselId: r.vesselId ?? null } : {}
}

const DEFAULT_MANIFOLD: Manifold = { installed: false, outlets: 2 }

/** COPVs filled together in one fill. */
export const parallelCount = (m: Manifold) => (m.installed ? Math.max(1, Math.round(m.outlets)) : 1)

/** COPVs already filled in this campaign (a fill on the manifold covers several). */
export const copvsDone = (history: HistoryEntry[]) => history.reduce((n, h) => n + (h.copvs ?? 1), 0)

/**
 * Make `source` the feed of pump step `pumpUid`: a bundle id, or "step:<uid>" for a bundle-manifold step or another
 * pump discharging into this one (in series). The feeding step (the one given, else the bundle's nearest free
 * valve step) switches to "into <pump>" instead of filling the COPV; steps that fed this pump before go back to it.
 */
function linkFeed(sequence: SequenceItem[], pumpUid: string, source: string | null, feedUid?: string): SequenceItem[] {
  const stepUid = source?.startsWith('step:') ? source.slice(5) : null
  const sourceId = stepUid ? null : source
  const pumpAt = sequence.findIndex((it) => it.uid === pumpUid)
  let feedAt = stepUid ? sequence.findIndex((it) => it.uid === stepUid) : feedUid ? sequence.findIndex((it) => it.uid === feedUid) : -1
  if (feedAt < 0 && sourceId) {
    let best = Infinity
    sequence.forEach((it, i) => {
      const free = it.type === 'source' && it.sourceId === sourceId && !it.targetId && !it.feedsUid
      if (free && Math.abs(i - pumpAt) < best) [best, feedAt] = [Math.abs(i - pumpAt), i]
    })
  }
  return sequence.map((it, i) => {
    if (it.uid === pumpUid && it.type === 'pump') return { ...it, sourceId, feedStepUid: stepUid }
    if (it.type === 'cooldown') return it
    if (i === feedAt) return { ...it, feedsUid: pumpUid, targetId: null, stopBarg: null }
    if (it.type === 'pump' && stepUid && it.feedStepUid === stepUid) return { ...it, feedStepUid: null } // a step feeds one pump
    return it.feedsUid === pumpUid ? { ...it, feedsUid: null } : it
  })
}

const emptySlot = { result: null, loading: false, error: null }

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialScenario(),
      view: 'manual',
      minGainBar: 10,
      maxCooldowns: 4,
      editing: null,
      sim: emptySlot,
      opt: { ...emptySlot, inputKey: null },
      campaign: { ...emptySlot, inputKey: null },

      setAmbient: (c) => set((s) => ({ settings: { ...s.settings, ambientTempC: c } })),
      setMode: (mode) => set((s) => ({ settings: { ...s.settings, mode } })),
      setView: (view) => set({ view }),
      setCopv: (patch) => set((s) => ({ copv: { ...s.copv, ...patch } })),
      setCopvCount: (copvCount) => set({ copvCount }),
      setMinGain: (minGainBar) => set({ minGainBar }),
      setMaxCooldowns: (maxCooldowns) => set({ maxCooldowns }),
      setMachine: (kind, patch) => set((s) => ({ equipment: { ...s.equipment, [kind]: { ...s.equipment[kind], ...patch } } })),
      resetMachine: (kind) => set((s) => ({ equipment: { ...s.equipment, [kind]: DEFAULT_MACHINES[kind] } })),
      openEditor: (editing) => set({ editing }),
      setAfterTest: (patch) => set((s) => ({ afterTest: { ...s.afterTest, ...patch } })),
      setHeatExchanger: (patch) => set((s) => ({ heatExchanger: { ...s.heatExchanger, ...patch } })),
      setManifold: (patch) => set((s) => ({ manifold: { ...s.manifold, ...patch } })),
      setTimeModel: (patch) => set((s) => ({ timeModel: { ...s.timeModel, ...patch } })),

      addSource: (kind) => {
        const n = get().counters[kind] + 1
        const source = makeSource(kind, n, get().copv.fluid)
        set((s) => ({ sources: [...s.sources, source], counters: { ...s.counters, [kind]: n } }))
        return source.id
      },
      updateSource: (id, patch) =>
        set((s) => ({
          sources: s.sources.map((src) => {
            if (src.id !== id) return src
            const next = { ...src, ...patch }
            // Switching gas resets an untouched default rating to the new gas's default.
            if (patch.fluid && patch.fluid !== src.fluid && src.ratedBarg === FLUID_DEFAULT_PRESSURE[src.fluid]) {
              next.ratedBarg = FLUID_DEFAULT_PRESSURE[patch.fluid]
              if (src.filled) next.pressureBarg = next.ratedBarg
            }
            // Ticking "filled" (or changing the rating while filled) puts the bundle at its rating.
            if (next.filled) next.pressureBarg = next.ratedBarg
            next.pressureBarg = Math.min(next.pressureBarg, next.ratedBarg)
            return next
          }),
        })),
      removeSource: (id) =>
        set((s) => ({
          sources: s.sources.filter((src) => src.id !== id),
          sequence: s.sequence
            .filter((it) => it.type !== 'source' || it.sourceId !== id)
            .map((it) => (it.type === 'pump' && it.sourceId === id ? { ...it, sourceId: null } : it))
            .map((it) => (it.type !== 'cooldown' && it.targetId === id ? { ...it, targetId: null, stopBarg: null } : it))
            .map((it) => (it.type === 'manifold' ? { ...it, sourceIds: it.sourceIds.filter((x) => x !== id) } : it)),
          excluded: s.excluded.filter((x) => x !== id),
          afterTest: s.afterTest.vesselId === id ? { ...s.afterTest, vesselId: null } : s.afterTest,
        })),
      toggleExcluded: (id) =>
        set((s) => ({ excluded: s.excluded.includes(id) ? s.excluded.filter((x) => x !== id) : [...s.excluded, id] })),

      insertSequence: (item, index) =>
        set((s) => {
          const sequence = [...s.sequence]
          const added = { ...item, uid: uid() } as SequenceItem
          sequence.splice(index ?? sequence.length, 0, added)
          // a new pump takes over its feed bundle's own step, as if the feed had been picked by hand
          return { sequence: added.type === 'pump' && added.sourceId ? linkFeed(sequence, added.uid, added.sourceId) : sequence }
        }),
      setPumpSource: (id, sourceId) => set((s) => ({ sequence: linkFeed(s.sequence, id, sourceId) })),
      setStepTarget: (id, patch) =>
        set((s) => {
          const step = s.sequence.find((it) => it.uid === id)
          if (patch.feedsUid && step?.type === 'source') {
            // "into <pump>": this bundle becomes the pump's feed
            return { sequence: linkFeed(s.sequence, patch.feedsUid, step.sourceId, id) }
          }
          // a manifold, or a pump discharging into another pump (in series)
          if (patch.feedsUid && (step?.type === 'manifold' || step?.type === 'pump')) return { sequence: linkFeed(s.sequence, patch.feedsUid, `step:${id}`) }
          // sending the gas elsewhere unlinks the step from any pump it fed
          const pumps = new Set(s.sequence.flatMap((it) => (it.uid === id && it.type !== 'cooldown' && it.feedsUid ? [it.feedsUid] : [])))
          return {
            sequence: s.sequence.map((it) => {
              if (it.uid === id && it.type !== 'cooldown') return { ...it, ...patch, feedsUid: null }
              if (it.type === 'pump' && pumps.has(it.uid) && it.feedStepUid === id) return { ...it, feedStepUid: null }
              return it
            }),
          }
        }),
      moveSequence: (from, to) =>
        set((s) => {
          const sequence = [...s.sequence]
          const [moved] = sequence.splice(from, 1)
          sequence.splice(to, 0, moved)
          return { sequence }
        }),
      removeSequence: (id) =>
        set((s) => ({
          sequence: s.sequence
            .filter((it) => it.uid !== id)
            .map((it) => {
              if (it.type === 'cooldown') return it
              const next = it.feedsUid === id ? { ...it, feedsUid: null } : it
              return next.type === 'pump' && next.feedStepUid === id ? { ...next, feedStepUid: null } : next
            }),
        })),
      addToManifold: (id, sourceId) =>
        set((s) => ({
          sequence: s.sequence.map((it) =>
            it.uid === id && it.type === 'manifold' && !it.sourceIds.includes(sourceId) ? { ...it, sourceIds: [...it.sourceIds, sourceId] } : it,
          ),
        })),
      removeFromManifold: (id, sourceId) =>
        set((s) => ({
          sequence: s.sequence.map((it) => (it.uid === id && it.type === 'manifold' ? { ...it, sourceIds: it.sourceIds.filter((x) => x !== sourceId) } : it)),
        })),
      clearSequence: () => set({ sequence: [] }),
      applyPlan: (plan) =>
        set({
          sequence: plan.map((p): SequenceItem => {
            const to = { targetId: p.target_id ?? null, stopBarg: p.stop_barg ?? null }
            if (p.type === 'pump') return { uid: uid(), type: 'pump', machine: p.machine ?? 'booster', sourceId: p.source_id, ...to }
            if (p.type === 'source' && p.source_id) return { uid: uid(), type: 'source', sourceId: p.source_id, ...to }
            return { uid: uid(), type: 'cooldown' }
          }),
          view: 'manual',
        }),

      commitFill: () => {
        const { sim, sources, sequence, copv, settings, history } = get()
        const result = sim.result
        if (!result) return
        const byId = new Map(result.sources.map((r) => [r.id, r]))
        const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
        const entry: HistoryEntry = {
          id: uid(),
          at: new Date().toISOString(),
          fluid: copv.fluid,
          mode: settings.mode,
          steps: sequence.map((it) => sequenceLabel(it, labels, sequence)),
          settledBarg: result.summary.copv_settled.pressure_barg,
          targetBarg: copv.targetBarg,
          reached: result.summary.target_reached,
          deliveredKg: result.summary.delivered_kg,
          wastedKj: result.summary.wasted_exergy_kj,
          poolBefore: sources,
          sequenceBefore: sequence,
          copvs: result.summary.parallel,
        }
        set({
          // Each source keeps the gas left after this fill (and any recovered gas), quoted at 20 °C again.
          sources: sources.map((s) => {
            const r = byId.get(s.id)
            if (!r) return s
            const pressureBarg = Math.min(Math.max(0, Math.round(r.pressure_ref_barg * 100) / 100), s.ratedBarg)
            return { ...s, pressureBarg, filled: pressureBarg >= s.ratedBarg - 0.05 }
          }),
          sequence: [],
          history: [entry, ...history],
          sim: emptySlot,
        })
      },
      undoLastFill: () => {
        const [last, ...rest] = get().history
        if (!last) return
        set({ sources: last.poolBefore, sequence: last.sequenceBefore, history: rest })
      },
      newCampaign: () => set({ history: [], campaign: { ...emptySlot, inputKey: null } }),

      importScenario: (data) =>
        set((s) => ({
          settings: data.settings ?? s.settings,
          copv: { ...DEFAULT_COPV, ...data.copv },
          sources: data.sources ? data.sources.map(upgradeSource) : s.sources,
          sequence: data.sequence ?? [],
          equipment: { ...DEFAULT_MACHINES, ...data.equipment },
          afterTest: { ...DEFAULT_AFTER_TEST, ...data.afterTest },
          heatExchanger: { ...DEFAULT_HX, ...data.heatExchanger },
          manifold: { ...DEFAULT_MANIFOLD, ...data.manifold },
          timeModel: { ...DEFAULT_TIME, ...data.timeModel },
          copvCount: data.copvCount ?? s.copvCount,
          history: data.history ?? s.history,
          excluded: [],
          sim: emptySlot,
          opt: { ...emptySlot, inputKey: null },
          campaign: { ...emptySlot, inputKey: null },
        })),
      resetAll: () =>
        set({
          ...initialScenario(),
          sim: emptySlot,
          opt: { ...emptySlot, inputKey: null },
          campaign: { ...emptySlot, inputKey: null },
        }),

      setSim: (patch) => set((s) => ({ sim: { ...s.sim, ...patch } })),
      setOpt: (patch) => set((s) => ({ opt: { ...s.opt, ...patch } })),
      setCampaign: (patch) => set((s) => ({ campaign: { ...s.campaign, ...patch } })),
    }),
    {
      name: STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        settings: s.settings,
        copv: s.copv,
        sources: s.sources,
        sequence: s.sequence,
        equipment: s.equipment,
        afterTest: s.afterTest,
        heatExchanger: s.heatExchanger,
        manifold: s.manifold,
        timeModel: s.timeModel,
        copvCount: s.copvCount,
        view: s.view,
        minGainBar: s.minGainBar,
        maxCooldowns: s.maxCooldowns,
        excluded: s.excluded,
        history: s.history,
        counters: s.counters,
      }),
      migrate: (persisted) => persisted as AppState,
      // Saved scenarios from older versions lack newer fields: fill them from the defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          ...p,
          sources: (p.sources ?? current.sources).map(upgradeSource),
          copv: { ...current.copv, ...p.copv },
          equipment: {
            booster: { ...DEFAULT_MACHINES.booster, ...p.equipment?.booster },
            compressor: { ...DEFAULT_MACHINES.compressor, ...p.equipment?.compressor },
          },
          afterTest: { ...current.afterTest, ...legacyAfterTest(persisted), ...p.afterTest },
          heatExchanger: { ...current.heatExchanger, ...p.heatExchanger },
          manifold: { ...current.manifold, ...p.manifold },
          timeModel: { ...current.timeModel, ...p.timeModel },
        }
      },
    },
  ),
)
