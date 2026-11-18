import { Chip } from '../../../shared/ui'
import { FLUIDS } from '../format'
import type { Fluid } from '../types'

// Generic inputs and layout pieces live in src/shared/ui.tsx; this file keeps what is specific to cascade fill.

export function FluidChip({ fluid }: { fluid: Fluid }) {
  return (
    <Chip className={FLUIDS[fluid].chip}>
      <span className={`size-1.5 rounded-full ${FLUIDS[fluid].dot}`} />
      {FLUIDS[fluid].short}
    </Chip>
  )
}
