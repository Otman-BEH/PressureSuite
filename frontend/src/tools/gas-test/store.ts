import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newCycle, uid, upgradeCycles } from '../../shared/cycles'
import { defaultLeak, upgradeLeak, type LeakSettings } from '../../shared/leak'
import { toolStorage } from '../../shared/storage'
import { DEFAULT_WALL } from '../../shared/wall'
import type { Cycle, GasFluid, Inputs, Supply } from './types'

/** Usual full bundle pressure per gas (matches the backend default). */
export const BUNDLE_PRESSURE: Partial<Record<GasFluid, number>> = { Nitrogen: 300, Helium: 200 }
export const DEFAULT_BUNDLE_PRESSURE = 200
export const bundlePressureFor = (fluid: GasFluid) => BUNDLE_PRESSURE[fluid] ?? DEFAULT_BUNDLE_PRESSURE

const DEFAULT_SUPPLY: Supply = { bundleVolumeL: 600, bundlePressureBarg: 300, residualBarg: 20 }

export const defaultInputs = (): Inputs => ({
  fluid: 'Nitrogen',
  volumeL: 50,
  tempC: 20,
  wallEnabled: false,
  wall: DEFAULT_WALL,
  pressurisationBarMin: 10,
  ventBarMin: 20,
  cycles: [newCycle(250), newCycle(250), newCycle(250)],
  recording: false,
  repeatOn: false,
  repeat: 50,
  leak: defaultLeak(),
  supply: DEFAULT_SUPPLY,
})

/** Inputs from saved state or an imported file, brought up to date (see the hydro test store). */
export function upgradeInputs(saved: unknown): Inputs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Inputs>
  const base = defaultInputs()
  const known = Object.fromEntries(Object.keys(base).filter((k) => k in s).map((k) => [k, s[k as keyof Inputs]])) as Partial<Inputs>
  const cycles = upgradeCycles(known.cycles, base.cycles, 250)
  return {
    ...base,
    ...known,
    cycles,
    recording: known.recording ?? cycles.some((c) => c.measuredEndHoldBarg !== null),
    leak: upgradeLeak(known.leak),
    supply: {
      ...DEFAULT_SUPPLY,
      ...(known.supply ?? {}),
      // Older saves used null for "the usual pressure for the gas".
      bundlePressureBarg: known.supply?.bundlePressureBarg ?? bundlePressureFor(known.fluid ?? base.fluid),
    },
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
  setSupply: (patch: Partial<Supply>) => void
  load: (saved: unknown) => void
  reset: () => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      inputs: defaultInputs(),
      set: (patch) =>
        set((s) => {
          const next = { ...s.inputs, ...patch }
          // A new gas comes in its own bundles: 300 barg for N2, 200 barg for He.
          if (patch.fluid && patch.fluid !== s.inputs.fluid) next.supply = { ...next.supply, bundlePressureBarg: bundlePressureFor(patch.fluid) }
          return { inputs: next }
        }),
      setCycle: (id, patch) =>
        set((s) => ({ inputs: { ...s.inputs, cycles: s.inputs.cycles.map((c) => (c.uid === id ? { ...c, ...patch } : c)) } })),
      addCycle: () =>
        set((s) => {
          const last = s.inputs.cycles.at(-1)
          return { inputs: { ...s.inputs, cycles: [...s.inputs.cycles, last ? { ...last, uid: uid(), measuredEndHoldBarg: null } : newCycle(250)] } }
        }),
      removeCycle: (id) =>
        set((s) => (s.inputs.cycles.length <= 1 ? s : { inputs: { ...s.inputs, cycles: s.inputs.cycles.filter((c) => c.uid !== id) } })),
      replaceCycles: (cycles) => set((s) => ({ inputs: { ...s.inputs, cycles } })),
      setLeak: (patch) => set((s) => ({ inputs: { ...s.inputs, leak: { ...s.inputs.leak, ...patch } } })),
      setSupply: (patch) => set((s) => ({ inputs: { ...s.inputs, supply: { ...s.inputs.supply, ...patch } } })),
      load: (saved) => set({ inputs: upgradeInputs(saved) }),
      reset: () => set({ inputs: defaultInputs() }),
    }),
    {
      name: 'pressuresuite:gas-test',
      version: 3,
      storage: toolStorage(),
      partialize: (s) => ({ inputs: s.inputs }),
      merge: (saved, current) => ({ ...current, inputs: upgradeInputs((saved as Partial<State>)?.inputs) }),
    },
  ),
)
