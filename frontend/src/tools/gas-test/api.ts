import { cyclesPayload, repeatPayload } from '../../shared/cycles'
import { request } from '../../shared/http'
import { wallPayload } from '../../shared/wall'
import type { GasTestResponse, Inputs } from './types'

/** All Gas Test routes live under this prefix (see backend/pressuresuite/api/routes/gas_test.py). */
const TOOL = '/api/gas-test'

export function gasTestPayload(i: Inputs) {
  return {
    fluid: i.fluid,
    volume_l: i.volumeL,
    temp_c: i.tempC,
    wall: i.wallEnabled ? wallPayload(i.wall) : null,
    pressurisation_bar_min: i.pressurisationBarMin,
    vent_bar_min: i.ventBarMin,
    cycles: cyclesPayload(i.cycles, i.recording),
    repeat: repeatPayload(i.repeatOn, i.repeat),
    supply: {
      bundle_volume_l: i.supply.bundleVolumeL,
      bundle_pressure_barg: i.supply.bundlePressureBarg,
      residual_barg: i.supply.residualBarg,
    },
  }
}

export const api = {
  calculate: (i: Inputs, signal?: AbortSignal) => request<GasTestResponse>(`${TOOL}/calculate`, gasTestPayload(i), signal),
}
