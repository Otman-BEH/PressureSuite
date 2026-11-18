import type { Note } from '../../shared/ui'
import type { WallSpec } from '../../shared/wall'

export type CalcFluid = 'Nitrogen' | 'Helium' | 'Air' | 'Argon' | 'Oxygen' | 'Hydrogen' | 'Methane' | 'CarbonDioxide' | 'Water' | 'Ethanol'

export interface Inputs {
  fluid: CalcFluid
  volumeL: number
  pressureBarg: number
  tempC: number
  wallEnabled: boolean
  wall: WallSpec
}

export interface GasOut {
  real_isentropic_kj: number
  real_expansion_work_kj: number
  ideal_brode_kj: number
  ideal_isentropic_kj: number
  gamma: number
  compressibility_z: number
  end_temp_c: number
  end_quality: number | null
}

export interface LiquidOut {
  fluid_kj: number
  wall_kj: number | null
  total_kj: number
  bulk_modulus_mpa: number
  flashes: boolean
  isentropic_kj: number | null
}

export interface EquivalentOut {
  name: string
  unit_kj: number
  count: number
  reference: string
}

export interface StoredEnergyResponse {
  fluid: string
  phase: 'gas' | 'liquid'
  method: string
  pressure_barg: number
  pressure_bara: number
  temp_c: number
  density_kg_m3: number
  mass_kg: number
  energy_kj: number
  gas: GasOut | null
  liquid: LiquidOut | null
  tnt: { factor_mj_per_kg: number; tnt_kg: number }
  equivalents: EquivalentOut[]
  notes: Note[]
}

export interface StoredEnergyMeta {
  coolprop_version: string
  backend: string
  gauge_reference_bara: number
  tnt_mj_per_kg: number
  fluids: { name: CalcFluid; label: string; temp_min_c: number; temp_max_c: number; pressure_max_barg: number }[]
}
