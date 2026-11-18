import type { Note } from '../../shared/ui'
import type { Cycle, CycleResultBase, TimePoint } from '../../shared/cycles'
import type { LeakSettings } from '../../shared/leak'
import type { WallSpec } from '../../shared/wall'

export type GasFluid = 'Nitrogen' | 'Helium' | 'Air' | 'Argon' | 'Oxygen' | 'Hydrogen' | 'Methane'
export type { Cycle, TimePoint }

export interface Supply {
  bundleVolumeL: number
  /** Full bundle pressure; set to the usual one for the gas (300 barg N2, 200 barg He) when the gas changes */
  bundlePressureBarg: number
  residualBarg: number
}

export interface Inputs {
  fluid: GasFluid
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
  supply: Supply
}

export interface GasCycleOut extends CycleResultBase {
  hold_min: number
  vent_hold_min: number
  filled_kg: number
  filled_nm3: number
  vented_kg: number
  vented_nm3: number
  leaked_kg: number
  energy_kj: number
  tnt_kg: number
}

export interface GasTestResponse {
  cycles: GasCycleOut[]
  totals: {
    test_pressure_barg: number
    cycle_count: number
    used_kg: number
    used_nm3: number
    vented_kg: number
    leaked_kg: number
    left_in_vessel_kg: number
    peak_energy_kj: number
    duration_min: number
  }
  supply: {
    bundle_pressure_barg: number
    bundle_volume_l: number
    bundle_contents_kg: number
    bundle_contents_nm3: number
    decant_usable_kg: number | null
    bundles_decant: number | null
    booster_usable_kg: number
    bundles_booster: number
  }
  timeline: TimePoint[]
  notes: Note[]
}
