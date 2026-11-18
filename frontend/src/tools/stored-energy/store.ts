import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toolStorage } from '../../shared/storage'
import { DEFAULT_WALL } from '../../shared/wall'
import type { Inputs } from './types'

export const DEFAULT_INPUTS: Inputs = {
  fluid: 'Nitrogen',
  volumeL: 10,
  pressureBarg: 300,
  tempC: 20,
  wallEnabled: false,
  wall: DEFAULT_WALL,
}

/** Inputs from saved state or an imported file: only the fields this version knows (older saves had ambient and standoff). */
export function upgradeInputs(saved: unknown): Inputs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Inputs>
  const known = Object.fromEntries(Object.keys(DEFAULT_INPUTS).filter((k) => k in s).map((k) => [k, s[k as keyof Inputs]]))
  return { ...DEFAULT_INPUTS, ...known }
}

interface State {
  inputs: Inputs
  set: (patch: Partial<Inputs>) => void
  load: (saved: unknown) => void
  reset: () => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      inputs: DEFAULT_INPUTS,
      set: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),
      load: (saved) => set({ inputs: upgradeInputs(saved) }),
      reset: () => set({ inputs: DEFAULT_INPUTS }),
    }),
    {
      name: 'pressuresuite:stored-energy',
      version: 1,
      storage: toolStorage(),
      partialize: (s) => ({ inputs: s.inputs }),
      merge: (saved, current) => ({ ...current, inputs: upgradeInputs((saved as Partial<State>)?.inputs) }),
    },
  ),
)

/** Opens the Stored Energy tab with this vessel (used by the test tabs). */
export function openInStoredEnergy(patch: Partial<Inputs>) {
  useStore.getState().set(patch)
  window.location.hash = '/stored-energy'
}
