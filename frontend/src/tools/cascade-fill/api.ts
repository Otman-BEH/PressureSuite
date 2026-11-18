import type {
  AfterTest,
  ApiSequenceItem,
  CampaignResponse,
  Copv,
  Fluid,
  HeatExchanger,
  HxPreview,
  MachineKind,
  MachinePreview,
  MachineSpec,
  MetaResponse,
  OptimizeResponse,
  SequenceItem,
  Settings,
  SimulateResponse,
  Source,
  TimeModel,
} from './types'
import { request } from '../../shared/http'

export interface ScenarioPayload {
  settings: { ambient_temp_c: number; mode: Settings['mode'] }
  copv: {
    fluid: Copv['fluid']
    volume_l: number
    target_barg: number
    initial_barg: number
    wall_mass_kg: number
    wall_cp_j_kgk: number
    leak_pct: number
    parallel: number
  }
  sources: {
    id: string
    label: string
    kind: Source['kind']
    fluid: Source['fluid']
    pressure_barg: number
    rated_barg: number
    cylinder_volume_l: number
    cylinder_count: number
    quantity: number
  }[]
}

export function scenarioPayload(settings: Settings, copv: Copv, sources: Source[], parallel = 1): ScenarioPayload {
  return {
    settings: { ambient_temp_c: settings.ambientTempC, mode: settings.mode },
    copv: {
      fluid: copv.fluid,
      volume_l: copv.volumeL,
      target_barg: copv.targetBarg,
      initial_barg: copv.initialBarg,
      wall_mass_kg: copv.wallMassKg,
      wall_cp_j_kgk: copv.wallCpJkgK,
      leak_pct: copv.leakPct,
      parallel,
    },
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      fluid: s.fluid,
      pressure_barg: s.filled ? s.ratedBarg : s.pressureBarg,
      rated_barg: s.ratedBarg,
      cylinder_volume_l: s.cylinderVolumeL,
      cylinder_count: s.cylinderCount,
      quantity: s.quantity ?? 1,
    })),
  }
}

export function machinePayload(m: MachineSpec) {
  return {
    inlet_min_barg: m.inletMinBarg,
    inlet_max_barg: m.inletMaxBarg,
    outlet_max_barg: m.outletMaxBarg,
    max_ratio: m.maxRatio,
    stages: m.stages,
    efficiency: m.efficiencyPct / 100,
    intercooled: m.intercooled,
    flow_nm3_h: m.flowNm3h,
  }
}

export function exchangerPayload(hx: HeatExchanger) {
  return {
    installed: hx.installed,
    control: hx.control,
    outlet_temp_c: hx.outletTempC,
    coolant_temp_c: hx.coolantTempC,
    effectiveness_pct: hx.effectivenessPct,
  }
}

export interface EquipmentPayload {
  equipment: { booster: ReturnType<typeof machinePayload>; compressor: ReturnType<typeof machinePayload> }
  heat_exchanger: ReturnType<typeof exchangerPayload>
  after_test: { action: AfterTest['action']; vessel_id: string | null; vent_to_barg: number }
  time_model: {
    enabled: boolean
    orifice_mm: number
    max_rate_bar_min: number
    h_ext_w_m2k: number
    copv_area_m2: number | null
    settle_tolerance_k: number
    connection_min: number
    hold_min: number
  }
}

export function equipmentPayload(s: {
  equipment: Record<MachineKind, MachineSpec>
  heatExchanger: HeatExchanger
  afterTest: AfterTest
  timeModel: TimeModel
}): EquipmentPayload {
  const t = s.timeModel
  return {
    equipment: { booster: machinePayload(s.equipment.booster), compressor: machinePayload(s.equipment.compressor) },
    heat_exchanger: exchangerPayload(s.heatExchanger),
    after_test: { action: s.afterTest.action, vessel_id: s.afterTest.vesselId, vent_to_barg: s.afterTest.ventToBarg },
    time_model: {
      enabled: t.enabled,
      orifice_mm: t.orificeMm,
      max_rate_bar_min: t.maxRateBarMin,
      h_ext_w_m2k: t.hExtWm2K,
      copv_area_m2: t.copvAreaM2,
      settle_tolerance_k: t.settleToleranceK,
      connection_min: t.connectionMin,
      hold_min: t.holdMin,
    },
  }
}

interface Origin {
  source_id: string | null
  source_ids: string[] | null
  /** Machines the gas passes through, upstream first. */
  chain: MachineKind[]
}

export function toApiSequence(sequence: SequenceItem[]): ApiSequenceItem[] {
  const byUid = new Map(sequence.map((s) => [s.uid, s]))
  // Where a step's gas comes from: its bundle(s), through any pumps feeding it in series.
  const origin = (s: SequenceItem, depth = 0): Origin => {
    if (s.type === 'manifold') return { source_id: s.sourceIds[0] ?? null, source_ids: s.sourceIds, chain: [] }
    if (s.type === 'source') return { source_id: s.sourceId, source_ids: null, chain: [] }
    if (s.type === 'cooldown') return { source_id: null, source_ids: null, chain: [] }
    const up = s.feedStepUid ? byUid.get(s.feedStepUid) : undefined
    const base = up && depth < 8 ? origin(up, depth + 1) : { source_id: s.sourceId, source_ids: null, chain: [] }
    return { ...base, chain: [...base.chain, s.machine] }
  }
  return sequence.map((s): ApiSequenceItem => {
    if (s.type === 'cooldown') return { type: 'cooldown', source_id: null }
    const to = { target_id: s.targetId ?? null, stop_barg: s.stopBarg ?? null, feeds_pump: !!s.feedsUid }
    const { source_id, source_ids, chain } = origin(s)
    if (s.type === 'pump') return { type: 'pump', source_id, source_ids, machine: s.machine, feed_machines: chain.slice(0, -1), ...to }
    return { type: 'source', source_id, source_ids, ...to }
  })
}

/** All COPV Cascade Fill routes live under this prefix (see backend/pressuresuite/api/routes/cascade_fill.py). */
const TOOL = '/api/cascade-fill'

interface OptimizeOptions {
  sourceIds: string[]
  minGainBar: number
  maxCooldowns: number
}

export const api = {
  meta: () => request<MetaResponse>(`${TOOL}/meta`),
  simulate: (payload: ScenarioPayload, extras: EquipmentPayload, sequence: SequenceItem[], signal?: AbortSignal) =>
    request<SimulateResponse>(`${TOOL}/simulate`, { ...payload, ...extras, sequence: toApiSequence(sequence) }, signal),
  optimize: (payload: ScenarioPayload, hx: HeatExchanger, opts: OptimizeOptions) =>
    request<OptimizeResponse>(`${TOOL}/optimize`, {
      ...payload,
      heat_exchanger: exchangerPayload(hx),
      source_ids: opts.sourceIds,
      min_gain_bar: opts.minGainBar,
      max_cooldowns: opts.maxCooldowns,
    }),
  campaign: (payload: ScenarioPayload, extras: EquipmentPayload, opts: OptimizeOptions & { count: number }) =>
    request<CampaignResponse>(`${TOOL}/campaign`, {
      ...payload,
      ...extras,
      source_ids: opts.sourceIds,
      min_gain_bar: opts.minGainBar,
      max_cooldowns: opts.maxCooldowns,
      count: opts.count,
    }),
  hxPreview: (fluid: Fluid, ambientC: number, hx: HeatExchanger, inletC: number, pressureBarg: number, signal?: AbortSignal) =>
    request<HxPreview>(
      `${TOOL}/heat-exchanger/preview`,
      { fluid, ambient_temp_c: ambientC, exchanger: exchangerPayload(hx), inlet_temp_c: inletC, pressure_barg: pressureBarg },
      signal,
    ),
  machinePreview: (fluid: Fluid, ambientC: number, machine: MachineSpec, inletBarg: number, outletBarg: number, signal?: AbortSignal) =>
    request<MachinePreview>(
      `${TOOL}/machine/preview`,
      { fluid, ambient_temp_c: ambientC, machine: machinePayload(machine), inlet_barg: inletBarg, outlet_barg: outletBarg },
      signal,
    ),
}
