import { fmt, fmtMin } from '../../shared/format'
import type { LampStatus } from '../../shared/ui'
import type { Fluid, HeatExchanger, MachineKind, MachineSpec, Mode, Source, StepStatus, TimeModel } from './types'

export const SOURCE_REF_TEMP_C = 20
export const FLUID_DEFAULT_PRESSURE: Record<Fluid, number> = { Nitrogen: 300, Helium: 200 }

export const FLUIDS: Record<Fluid, { short: string }> = {
  Nitrogen: { short: 'N₂' },
  Helium: { short: 'He' },
}

export const MODES: Record<Mode, { label: string; hint: string }> = {
  isothermal: { label: 'Isothermal', hint: 'Slow fill: every vessel stays at ambient temperature.' },
  adiabatic: {
    label: 'Adiabatic',
    hint: 'Fast fill, no heat exchange: gas left in the sources cools, COPV gas heats up.',
  },
  adiabatic_wall: {
    label: 'Adiabatic + wall',
    hint: 'Fast fill; the COPV liner and overwrap absorb heat (wall stays at gas temperature).',
  },
}

export const MACHINES: Record<MachineKind, { name: string; role: string }> = {
  booster: { name: 'Boost pump', role: 'Pushes gas from a source into the COPV, even below COPV pressure' },
  compressor: { name: 'Compressor', role: 'Low-pressure feed (alone or into the boost pump) and gas recovery after the test' },
}

export const DEFAULT_MACHINES: Record<MachineKind, MachineSpec> = {
  booster: { inletMinBarg: 20, inletMaxBarg: 250, outletMaxBarg: 400, maxRatio: 10, stages: 2, efficiencyPct: 70, intercooled: true, flowNm3h: 30 },
  compressor: { inletMinBarg: 0, inletMaxBarg: 10, outletMaxBarg: 300, maxRatio: 400, stages: 4, efficiencyPct: 70, intercooled: true, flowNm3h: 15 },
}

export const DEFAULT_HX: HeatExchanger = {
  installed: false,
  control: 'outlet_temp',
  outletTempC: 20,
  coolantTempC: 20,
  effectivenessPct: 80,
}

export const DEFAULT_TIME: TimeModel = {
  enabled: false,
  orificeMm: 2,
  maxRateBarMin: 0,
  hExtWm2K: 10,
  copvAreaM2: null,
  settleToleranceK: 2,
  connectionMin: 3,
  holdMin: 10,
}

/** Step results as status lamps (DESIGN.md): ok when a goal is met, warn at a limit, crit for wrong input, idle otherwise. */
export const STATUS: Record<StepStatus, { label: string; lamp: LampStatus }> = {
  vented: { label: 'Vented', lamp: 'idle' },
  filled: { label: 'Bundle filled', lamp: 'ok' },
  feeds_pump: { label: 'Feeds pump', lamp: 'idle' },
  target_reached: { label: 'Target reached', lamp: 'ok' },
  equalized: { label: 'Equalized', lamp: 'idle' },
  inlet_limit: { label: 'Inlet limit', lamp: 'warn' },
  outlet_limit: { label: 'Outlet limit', lamp: 'warn' },
  ratio_limit: { label: 'Ratio limit', lamp: 'warn' },
  no_flow: { label: 'No flow', lamp: 'warn' },
  not_needed: { label: 'Not needed', lamp: 'idle' },
  cooled: { label: 'Cooled', lamp: 'idle' },
  fluid_mismatch: { label: 'Wrong gas', lamp: 'crit' },
}

export { fmt, fmtMin }

export const cToK = (c: number) => c + 273.15
export const totalVolumeL = (s: Pick<Source, 'cylinderVolumeL' | 'cylinderCount' | 'quantity'>) =>
  s.cylinderVolumeL * s.cylinderCount * (s.quantity ?? 1)

/** "Bundle 1", or "Bundle 1 ×4" for a set of identical units. */
export const sourceName = (s: Pick<Source, 'label' | 'quantity'>) => (s.quantity > 1 ? `${s.label} ×${s.quantity}` : s.label)

export function describeSize(s: Source): string {
  const one = s.kind === 'bundle' ? `${s.cylinderCount} × ${fmt(s.cylinderVolumeL, 0)} L` : `${fmt(s.cylinderVolumeL, 0)} L`
  if (s.quantity > 1) return `${s.quantity} × ${s.kind === 'bundle' ? `(${one})` : one} = ${fmt(totalVolumeL(s), 0)} L`
  return s.kind === 'bundle' ? `${one} = ${fmt(totalVolumeL(s), 0)} L` : one
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}
