import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newCycle, uid, upgradeCycles } from '../../shared/cycles'
import { defaultLeak, upgradeLeak, type LeakSettings } from '../../shared/leak'
import { toolStorage } from '../../shared/storage'
import { DEFAULT_WALL } from '../../shared/wall'
import type { Cycle, Inputs, VolumeCheckInputs, VolumeRun } from './types'

export const newVolumeRun = (from?: VolumeRun): VolumeRun =>
  from ? { ...from, uid: uid() } : { uid: uid(), fromBarg: 0, toBarg: 300, pumpedL: 1.33, returnedL: null }

const defaultVolumeCheck = (): VolumeCheckInputs => ({ mode: 'tank', pocketGas: 'Air', runs: [newVolumeRun()] })

/** Older saves had a single run with a "use returned" switch. */
function upgradeVolumeCheck(saved: unknown): VolumeCheckInputs {
  const base = defaultVolumeCheck()
  if (!saved || typeof saved !== 'object') return base
  const v = saved as Partial<VolumeCheckInputs> & { fromBarg?: number; toBarg?: number; pumpedL?: number; useReturned?: boolean; returnedL?: number }
  const runs = Array.isArray(v.runs) && v.runs.length
    ? v.runs.map((r) => ({ ...newVolumeRun(), ...r, returnedL: r.returnedL ?? null }))
    : [{ ...newVolumeRun(), fromBarg: v.fromBarg ?? 0, toBarg: v.toBarg ?? 300, pumpedL: v.pumpedL ?? 1.33, returnedL: v.useReturned ? (v.returnedL ?? null) : null }]
  return { mode: v.mode ?? base.mode, pocketGas: v.pocketGas ?? base.pocketGas, runs }
}

export const defaultInputs = (): Inputs => ({
  fluid: 'Water',
  volumeL: 100,
  tempC: 20,
  wallEnabled: false,
  wall: DEFAULT_WALL,
  pressurisationBarMin: 10,
  ventBarMin: 20,
  cycles: [newCycle(), newCycle(), newCycle()],
  recording: false,
  repeatOn: false,
  repeat: 50,
  leak: defaultLeak(),
  volumeCheck: defaultVolumeCheck(),
})

/**
 * Inputs from saved state or an imported file, brought up to date: keeps only the fields this version knows and
 * upgrades older shapes (MEOP/proof settings, cycles without hold at vent, a "ramp" rate, an input leak rate, a single
 * volume check run). Readings already entered switch "Record readings" on.
 */
export function upgradeInputs(saved: unknown): Inputs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Inputs> & { rampBarMin?: number }
  const base = defaultInputs()
  const known = Object.fromEntries(Object.keys(base).filter((k) => k in s).map((k) => [k, s[k as keyof Inputs]])) as Partial<Inputs>
  const cycles = upgradeCycles(known.cycles, base.cycles)
  return {
    ...base,
    ...known,
    cycles,
    recording: known.recording ?? cycles.some((c) => c.measuredEndHoldBarg !== null),
    pressurisationBarMin: known.pressurisationBarMin ?? s.rampBarMin ?? base.pressurisationBarMin,
    leak: upgradeLeak(known.leak),
    volumeCheck: upgradeVolumeCheck(known.volumeCheck),
  }
}

interface State {
  inputs: Inputs
  set: (patch: Partial<Inputs>) => void
  setCycle: (uid: string, patch: Partial<Cycle>) => void
  addCycle: () => void
  removeCycle: (uid: string) => void
  replaceCycles: (cycles: Cycle[]) => void
  setLeak: (patch: Partial<LeakSettings>) => void
  setVolumeCheck: (patch: Partial<VolumeCheckInputs>) => void
  setVolumeRun: (uid: string, patch: Partial<VolumeRun>) => void
  addVolumeRun: () => void
  removeVolumeRun: (uid: string) => void
  load: (saved: unknown) => void
  reset: () => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      inputs: defaultInputs(),
      set: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),
      setCycle: (id, patch) =>
        set((s) => ({ inputs: { ...s.inputs, cycles: s.inputs.cycles.map((c) => (c.uid === id ? { ...c, ...patch } : c)) } })),
      addCycle: () =>
        set((s) => {
          const last = s.inputs.cycles.at(-1)
          return { inputs: { ...s.inputs, cycles: [...s.inputs.cycles, last ? { ...last, uid: uid(), measuredEndHoldBarg: null } : newCycle()] } }
        }),
      removeCycle: (id) =>
        set((s) => (s.inputs.cycles.length <= 1 ? s : { inputs: { ...s.inputs, cycles: s.inputs.cycles.filter((c) => c.uid !== id) } })),
      replaceCycles: (cycles) => set((s) => ({ inputs: { ...s.inputs, cycles } })),
      setLeak: (patch) => set((s) => ({ inputs: { ...s.inputs, leak: { ...s.inputs.leak, ...patch } } })),
      setVolumeCheck: (patch) => set((s) => ({ inputs: { ...s.inputs, volumeCheck: { ...s.inputs.volumeCheck, ...patch } } })),
      setVolumeRun: (id, patch) =>
        set((s) => {
          const v = s.inputs.volumeCheck
          return { inputs: { ...s.inputs, volumeCheck: { ...v, runs: v.runs.map((r) => (r.uid === id ? { ...r, ...patch } : r)) } } }
        }),
      addVolumeRun: () =>
        set((s) => {
          const v = s.inputs.volumeCheck
          return { inputs: { ...s.inputs, volumeCheck: { ...v, runs: [...v.runs, newVolumeRun(v.runs.at(-1))] } } }
        }),
      removeVolumeRun: (id) =>
        set((s) => {
          const v = s.inputs.volumeCheck
          return v.runs.length <= 1 ? s : { inputs: { ...s.inputs, volumeCheck: { ...v, runs: v.runs.filter((r) => r.uid !== id) } } }
        }),
      load: (saved) => set({ inputs: upgradeInputs(saved) }),
      reset: () => set({ inputs: defaultInputs() }),
    }),
    {
      name: 'pressuresuite:hydro-test',
      version: 5,
      storage: toolStorage(),
      partialize: (s) => ({ inputs: s.inputs }),
      merge: (saved, current) => ({ ...current, inputs: upgradeInputs((saved as Partial<State>)?.inputs) }),
    },
  ),
)
