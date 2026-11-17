import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** One entry per tab. Add a tool by building it under tools/<id>/ and listing it here. */
export interface Tool {
  /** URL-safe id, used in the address bar (#/<id>) and matching the backend route prefix /api/<id>/. */
  id: string
  name: string
  description: string
  /** Loaded on first open, so each tool's code (and its libraries) is a separate download. */
  component: LazyExoticComponent<ComponentType>
}

export const TOOLS: Tool[] = [
  {
    id: 'cascade-fill',
    name: 'COPV Cascade Fill',
    description: 'Cascade fill simulator & optimizer',
    component: lazy(() => import('./cascade-fill/CascadeFillTool').then((m) => ({ default: m.CascadeFillTool }))),
  },
]
