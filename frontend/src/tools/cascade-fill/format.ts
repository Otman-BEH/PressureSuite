import type { Fluid, HeatExchanger, MachineKind, MachineSpec, Mode, Source, StepStatus, TimeModel } from './types'

export const SOURCE_REF_TEMP_C = 20
export const FLUID_DEFAULT_PRESSURE: Record<Fluid, number> = { Nitrogen: 300, Helium: 200 }

export const FLUIDS: Record<Fluid, { short: string; dot: string; chip: string }> = {
  Nitrogen: { short: 'N₂', dot: 'bg-sky-600', chip: 'bg-sky-50 text-sky-800 ring-sky-200' },
  Helium: { short: 'He', dot: 'bg-violet-600', chip: 'bg-violet-50 text-violet-800 ring-violet-200' },
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
  outletTempC: 5,
  coolantTempC: 5,
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

/** Minutes as "45 min" or "2 h 05 min". */
export function fmtMin(min: number): string {
  if (min < 60) return `${fmt(min, min < 10 ? 1 : 0)} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(Math.round(min - h * 60)).padStart(2, '0')} min`
}

export const STATUS: Record<StepStatus, { label: string; chip: string }> = {
  vented: { label: 'Vented', chip: 'bg-slate-100 text-slate-700 ring-slate-300' },
  filled: { label: 'Bundle filled', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  feeds_pump: { label: 'Feeds pump', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  target_reached: { label: 'Target reached', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  equalized: { label: 'Equalized', chip: 'bg-sky-50 text-sky-800 ring-sky-200' },
  inlet_limit: { label: 'Inlet limit', chip: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  outlet_limit: { label: 'Outlet limit', chip: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  ratio_limit: { label: 'Ratio limit', chip: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  no_flow: { label: 'No flow', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  not_needed: { label: 'Not needed', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  cooled: { label: 'Cooled', chip: 'bg-cyan-50 text-cyan-800 ring-cyan-200' },
  fluid_mismatch: { label: 'Wrong gas', chip: 'bg-rose-50 text-rose-800 ring-rose-200' },
}

export function fmt(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

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
