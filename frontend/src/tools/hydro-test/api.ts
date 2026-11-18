import { cyclesPayload, repeatPayload } from '../../shared/cycles'
import { request } from '../../shared/http'
import { wallPayload } from '../../shared/wall'
import type { HydroTestResponse, Inputs, VolumeCheckResponse } from './types'

/** All Hydrostatic Test routes live under this prefix (see backend/pressuresuite/api/routes/hydro_test.py). */
const TOOL = '/api/hydro-test'

export function hydroTestPayload(i: Inputs) {
  return {
    fluid: i.fluid,
    volume_l: i.volumeL,
    temp_c: i.tempC,
    wall: i.wallEnabled ? wallPayload(i.wall) : null,
    pressurisation_bar_min: i.pressurisationBarMin,
    vent_bar_min: i.ventBarMin,
    cycles: cyclesPayload(i.cycles, i.recording),
    repeat: repeatPayload(i.repeatOn, i.repeat),
  }
}

export function volumeCheckPayload(i: Inputs) {
  const v = i.volumeCheck
  return {
    mode: v.mode,
    fluid: i.fluid,
    temp_c: i.tempC,
    wall: i.wallEnabled ? wallPayload(i.wall) : null,
    volume_l: i.volumeL,
    pocket_gas: v.pocketGas,
    runs: v.runs.map((r) => ({ from_barg: r.fromBarg, to_barg: r.toBarg, pumped_l: r.pumpedL, returned_l: r.returnedL })),
  }
}

export const api = {
  calculate: (i: Inputs, signal?: AbortSignal) => request<HydroTestResponse>(`${TOOL}/calculate`, hydroTestPayload(i), signal),
  volumeCheck: (i: Inputs, signal?: AbortSignal) => request<VolumeCheckResponse>(`${TOOL}/volume-check`, volumeCheckPayload(i), signal),
}
