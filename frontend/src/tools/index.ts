import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** One entry per tab. Add a tool by building it under tools/<id>/ and listing it here. */
export interface Tool {
  /** URL-safe id, used in the address bar (#/<id>) and matching the backend route prefix /api/<id>/. */
  id: string
  name: string
  description: string
  /** Gauge-pressure convention, shown in the status bar. */
  gauge: string
  /** Longer conventions and modelling notes for this tool, shown as the status bar tooltip. */
  gaugeDetail: string
  /** Loaded on first open, so each tool's code (and its libraries) is a separate download. */
  component: LazyExoticComponent<ComponentType>
}

export const TOOLS: Tool[] = [
  {
    id: 'cascade-fill',
    name: 'COPV Fill',
    description: 'COPV fill simulator & optimizer (cascade fill)',
    gauge: 'barg relative to 1 atm · sources quoted at 20 °C',
    gaugeDetail:
      'Pressures are gauge (barg). Source pressures are quoted at 20 °C; the COPV target is the settled pressure at ambient. All temperatures are gas temperatures; strain heating of the composite is not modelled.',
    component: lazy(() => import('./cascade-fill/CascadeFillTool').then((m) => ({ default: m.CascadeFillTool }))),
  },
  {
    id: 'stored-energy',
    name: 'Stored Energy',
    description: 'Gas and liquid stored energy, TNT equivalent',
    gauge: 'barg relative to 1 bar a',
    gaugeDetail: 'Gauge pressures are relative to 1 bar a. Energies are for an instantaneous release to 1 bar a.',
    component: lazy(() => import('./stored-energy/StoredEnergyTool').then((m) => ({ default: m.StoredEnergyTool }))),
  },
  {
    id: 'hydro-test',
    name: 'Hydrostatic Test',
    description: 'Hydro test cycles: fluid volumes, energy, timing',
    gauge: 'barg relative to 1 bar a',
    gaugeDetail: "Gauge pressures are relative to 1 bar a. Stored energy uses the Stored Energy tool's liquid calculation (p²V/2K plus wall strain).",
    component: lazy(() => import('./hydro-test/HydroTestTool').then((m) => ({ default: m.HydroTestTool }))),
  },
  {
    id: 'gas-test',
    name: 'Gas Test',
    description: 'Pneumatic acceptance test cycles, gas needed, bundles',
    gauge: 'barg relative to 1 bar a · Nm³ at 0 °C, 1 atm',
    gaugeDetail: "Gauge pressures are relative to 1 bar a. Stored energy uses the Stored Energy tool's real-gas calculation. Nm³ at 0 °C and 1 atm.",
    component: lazy(() => import('./gas-test/GasTestTool').then((m) => ({ default: m.GasTestTool }))),
  },
]
