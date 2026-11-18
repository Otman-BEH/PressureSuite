import { request } from '../../shared/http'
import { wallPayload } from '../../shared/wall'
import type { Inputs, StoredEnergyMeta, StoredEnergyResponse } from './types'

/** All Stored Energy routes live under this prefix (see backend/pressuresuite/api/routes/stored_energy.py). */
const TOOL = '/api/stored-energy'

export function storedEnergyPayload(i: Inputs) {
  return {
    fluid: i.fluid,
    volume_l: i.volumeL,
    pressure_barg: i.pressureBarg,
    temp_c: i.tempC,
    wall: i.wallEnabled ? wallPayload(i.wall) : null,
  }
}

export const api = {
  meta: () => request<StoredEnergyMeta>(`${TOOL}/meta`),
  calculate: (i: Inputs, signal?: AbortSignal) => request<StoredEnergyResponse>(`${TOOL}/calculate`, storedEnergyPayload(i), signal),
}
