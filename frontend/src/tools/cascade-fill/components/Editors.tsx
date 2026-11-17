import { useStore } from '../store'
import { HeatExchangerCard } from './HeatExchangerCard'
import { MachineCard } from './MachineCard'
import { ManifoldCard } from './ManifoldCard'
import { TimeModelCard } from './TimeModelCard'

/** Shows the property card that is open, if any. */
export function Editors() {
  const editing = useStore((s) => s.editing)
  if (editing === 'booster' || editing === 'compressor') return <MachineCard kind={editing} />
  if (editing === 'hx') return <HeatExchangerCard />
  if (editing === 'time') return <TimeModelCard />
  if (editing === 'manifold') return <ManifoldCard />
  return null
}
