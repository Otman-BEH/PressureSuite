import type { Note } from '../../shared/ui'
import type { Cycle, CycleResultBase, TimePoint } from '../../shared/cycles'
import type { LeakSettings } from '../../shared/leak'
import type { WallSpec } from '../../shared/wall'

export type TestFluid = 'Water' | 'Ethanol'
export type { Cycle, TimePoint }

/** One press (and optional depress) of the volume check. */
export interface VolumeRun {
  uid: string
  fromBarg: number
  toBarg: number
  pumpedL: number
  /** Liquid returned venting back down; null when not measured. */
  returnedL: number | null
}

export interface VolumeCheckInputs {
  mode: 'tank' | 'gas_pocket'
  pocketGas: 'Air' | 'Nitrogen' | 'Helium'
  runs: VolumeRun[]
}

export interface Inputs {
  fluid: TestFluid
  volumeL: number
  tempC: number
  wallEnabled: boolean
  wall: WallSpec
  pressurisationBarMin: number
  ventBarMin: number
  cycles: Cycle[]
  /** Show the measured end-of-hold column (during the test) */
  recording: boolean
  repeatOn: boolean
  repeat: number
  leak: LeakSettings
  volumeCheck: VolumeCheckInputs
}

export interface CycleOut extends CycleResultBase {
  hold_min: number
  vent_hold_min: number
  pumped_kg: number
  pumped_l: number
  pumped_compressibility_l: number
  pumped_tank_l: number
  returned_kg: number
  returned_l: number
  leaked_l: number
  energy_kj: number
  energy_fluid_kj: number
  energy_wall_kj: number | null
}

export interface HydroTestResponse {
  density_kg_m3: number
  bulk_modulus_mpa: number
  tank_dilation_per_bar: number | null
  cycles: CycleOut[]
  totals: {
    test_pressure_barg: number
    cycle_count: number
    pumped_kg: number
    pumped_l: number
    returned_kg: number
    returned_l: number
    leaked_l: number
    retained_l: number
    peak_energy_kj: number
    duration_min: number
  }
  timeline: TimePoint[]
  notes: Note[]
}

export interface VolumeRunOut {
  index: number
  from_press_l: number
  from_depress_l: number | null
  difference_pct: number | null
  expected_pumped_l: number | null
}

export interface VolumeCheckResponse {
  mode: 'tank' | 'gas_pocket'
  runs: VolumeRunOut[]
  mean_l: number
  spread_pct: number | null
  count: number
  pocket_energy_kj: number | null
  liquid_energy_kj: number | null
  notes: Note[]
}
