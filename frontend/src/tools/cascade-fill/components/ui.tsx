import { FLUIDS } from '../format'
import type { Fluid } from '../types'

// Generic inputs and layout pieces live in src/shared/ui.tsx; this file keeps what is specific to cascade fill.

/** The gas of a source or step, as plain mono text (fluids are named, not coloured). */
export function FluidChip({ fluid }: { fluid: Fluid }) {
  return <span className="font-mono text-small text-muted">{FLUIDS[fluid].short}</span>
}
