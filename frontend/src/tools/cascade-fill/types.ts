export type Fluid = 'Nitrogen' | 'Helium'
export type Mode = 'isothermal' | 'adiabatic' | 'adiabatic_wall'
export type SourceKind = 'bundle' | 'bottle'
export type View = 'manual' | 'optimize'
export type MachineKind = 'booster' | 'compressor'
export type StepStatus =
  | 'target_reached'
  | 'equalized'
  | 'inlet_limit'
  | 'outlet_limit'
  | 'ratio_limit'
  | 'vented'
  | 'filled'
  | 'feeds_pump'
  | 'no_flow'
  | 'not_needed'
  | 'cooled'
  | 'fluid_mismatch'

/** Boost pump or compressor. Pressures are gauge. */
export interface MachineSpec {
  inletMinBarg: number
  inletMaxBarg: number
  outletMaxBarg: number
  maxRatio: number
  stages: number
  efficiencyPct: number
  intercooled: boolean
  flowNm3h: number
}

export interface AfterTest {
  action: 'none' | 'vent' | 'recover'
  vesselId: string | null
  ventToBarg: number
}

/** Heat exchanger in the fill line, just before the COPV. */
export interface HeatExchanger {
  installed: boolean
  control: 'outlet_temp' | 'effectiveness'
  outletTempC: number
  coolantTempC: number
  effectivenessPct: number
}

/** Optional time estimate; it does not change temperatures or pressures. */
export interface TimeModel {
  enabled: boolean
  orificeMm: number
  maxRateBarMin: number
  hExtWm2K: number
  copvAreaM2: number | null
  settleToleranceK: number
  connectionMin: number
  holdMin: number
}

export type EditorKind = MachineKind | 'hx' | 'time' | 'manifold'

/** Distribution manifold: identical COPVs filled together, the gas split equally between them. */
export interface Manifold {
  installed: boolean
  outlets: number
}

export interface Source {
  id: string
  kind: SourceKind
  label: string
  fluid: Fluid
  /** Current gauge pressure at the 20 °C reference temperature. */
  pressureBarg: number
  /** Maximum pressure when this vessel is being filled. */
  ratedBarg: number
  /** Ticked: the current pressure is the rated pressure. */
  filled: boolean
  cylinderVolumeL: number
  cylinderCount: number
  /** Identical units: the card stands for this many, always at the same pressure and opened together. */
  quantity: number
}

/** Where a valve or pump step sends its gas: the COPV (targetId null) or another bundle until stopBarg. */
interface Destination {
  targetId?: string | null
  stopBarg?: number | null
}

export type SequenceItem =
  /** feedsUid: this valve step only connects its bundle to that pump step, which moves the gas. */
  | ({ uid: string; type: 'source'; sourceId: string; feedsUid?: string | null } & Destination)
  | { uid: string; type: 'cooldown' }
  /**
   * feedStepUid: the pump draws from that step instead of a single bundle (a bundle manifold, or another pump
   * discharging into it, in series). feedsUid: this pump only discharges into that pump step.
   */
  | ({ uid: string; type: 'pump'; machine: MachineKind; sourceId: string | null; feedStepUid?: string | null; feedsUid?: string | null } & Destination)
  /** Bundles opened together on a manifold: one shared pressure, one combined source. */
  | ({ uid: string; type: 'manifold'; sourceIds: string[]; feedsUid?: string | null } & Destination)

export interface Copv {
  fluid: Fluid
  volumeL: number
  /** Settled pressure once the gas is back at ambient temperature. */
  targetBarg: number
  initialBarg: number
  wallMassKg: number
  wallCpJkgK: number
  /** Extra gas lost per fill, as % of what reaches the COPV. */
  leakPct: number
}

export interface Settings {
  ambientTempC: number
  mode: Mode
}

export interface HistoryEntry {
  id: string
  at: string
  fluid: Fluid
  mode: Mode
  steps: string[]
  settledBarg: number
  targetBarg: number
  reached: boolean
  deliveredKg: number
  wastedKj: number
  poolBefore: Source[]
  sequenceBefore: SequenceItem[]
  /** COPVs filled together (manifold); missing in older saves = 1. */
  copvs?: number
}

// ---- API (snake_case, mirrors backend/app/models.py) ----

export interface ApiSequenceItem {
  type: 'source' | 'cooldown' | 'pump'
  source_id: string | null
  source_ids?: string[] | null
  machine?: MachineKind | null
  /** Machines in series upstream of `machine`, the first drawing from the source. */
  feed_machines?: MachineKind[] | null
  target_id?: string | null
  stop_barg?: number | null
  feeds_pump?: boolean
}

export interface VesselView {
  pressure_barg: number
  temp_c: number
  mass_kg: number
}

export interface StepOut {
  index: number
  type: 'source' | 'cooldown' | 'pump' | 'recovery' | 'vent'
  source_id: string | null
  source_ids: string[] | null
  machine: MachineKind | null
  feed_machines?: MachineKind[] | null
  status: StepStatus
  message: string
  delivered_kg: number
  leaked_kg: number
  settled_gain_bar: number
  wasted_exergy_kj: number
  energy_kwh: number
  outlet_temp_max_c: number | null
  hx_duty_kwh: number
  hx_outlet_min_c: number | null
  hx_outlet_max_c: number | null
  duration_min: number | null
  copv_before: VesselView
  copv_after: VesselView
  source_before: VesselView | null
  source_after: VesselView | null
  target_id: string | null
  target_before: VesselView | null
  target_after: VesselView | null
}

export interface TracePoint {
  step: number
  delivered_kg: number
  copv_barg: number
  copv_temp_c: number
  copv_settled_barg: number
  source_barg: number | null
}

export interface SourceResult {
  id: string
  start: VesselView
  end: VesselView
  settled_barg: number
  pressure_ref_barg: number
  used_kg: number
  connections: number
}

export interface Summary {
  target_barg: number
  target_reached: boolean
  shortfall_bar: number
  copv_end: VesselView
  copv_settled: VesselView
  peak_gas_temp_c: number
  peak_pressure_barg: number
  delivered_kg: number
  wasted_exergy_kj: number
  sources_opened: number
  connections: number
  cooldowns: number
  leaked_kg: number
  pump_energy_kwh: number
  pump_time_min: number
  recovered_kg: number
  recovery_energy_kwh: number
  recovery_time_min: number
  vented_kg: number
  copv_after_test: VesselView | null
  hx_duty_kwh: number
  hx_chiller_kwh: number
  time: TimeBreakdown | null
  /** COPVs filled together; masses in this summary are totals over all of them. */
  parallel: number
}

export interface TimeBreakdown {
  handling_min: number
  fill_min: number
  settle_min: number
  hold_min: number
  after_test_min: number
  total_min: number
  copv_area_m2: number
}

export interface TimelinePoint {
  t_min: number | null
  progress: number
  phase: string
  copv_barg: number
  copv_temp_c: number
  vessels: Record<string, number>
}

export interface SimulateResponse {
  steps: StepOut[]
  trace: TracePoint[]
  timeline: TimelinePoint[]
  summary: Summary
  sources: SourceResult[]
  warnings: string[]
}

export interface PlanOut {
  sequence: ApiSequenceItem[]
  summary: Summary
  meets_min_gain: boolean
}

export interface OptimizeResponse {
  best: PlanOut | null
  alternatives: PlanOut[]
  feasible: boolean
  search_complete: boolean
  evaluated_steps: number
  message: string
}

export interface CampaignFill {
  index: number
  copvs: number
  feasible: boolean
  sequence: ApiSequenceItem[]
  summary: Summary | null
  pool_after: { id: string; pressure_ref_barg: number; mass_kg: number }[]
  message: string
}

export interface CampaignResponse {
  count: number
  completed: number
  pool_start_kg: number
  fills: CampaignFill[]
  total_time_min: number | null
  message: string
}

export interface HxPreview {
  outlet_temp_c: number
  duty_kj_per_kg: number
  chiller_kj_per_kg: number
}

export interface MachinePreview {
  outlet_temp_c: number
  work_kj_per_kg: number
  ratio: number
  inlet_used_barg: number
  runs: boolean
  notes: string[]
}

export interface MetaResponse {
  coolprop_version: string
  backend: string
  source_ref_temp_c: number
  fluids: { name: Fluid; eos: string; default_pressure_barg: number }[]
}
