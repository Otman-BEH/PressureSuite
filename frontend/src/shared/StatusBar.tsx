import { useEffect, useState } from 'react'
import { request } from './http'
import { Lamp } from './ui'

interface Meta {
  coolprop_version: string
  backend: string
  fluids: { name: string; eos: string }[]
}

/** How often the backend lamp re-checks the connection. */
const POLL_MS = 15_000

/**
 * The instrument status line fixed to the bottom of the window: backend connection lamp, CoolProp version, backend
 * and equations of state, and the gauge-pressure convention of the open tool.
 */
export function StatusBar({ gauge, gaugeDetail }: { gauge: string; gaugeDetail: string }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    const check = () =>
      request<Meta>('/api/cascade-fill/meta').then(
        (m) => alive && (setMeta(m), setOnline(true)),
        () => alive && setOnline(false),
      )
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const eos = meta?.fluids.map((f) => `${f.name} ${f.eos}`).join(', ')
  const item = 'truncate border-l border-rule pl-3'
  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 flex h-6 items-center gap-3 border-t border-rule bg-surface px-3 font-mono text-small text-muted">
      {online === false ? (
        <Lamp status="crit" title="Start it with: python run.py (in backend/)">
          Backend not reachable: start it with python run.py in backend/
        </Lamp>
      ) : (
        <Lamp status={online ? 'ok' : 'idle'}>{online ? 'Backend connected' : 'Connecting…'}</Lamp>
      )}
      {meta && <span className={`shrink-0 ${item}`}>CoolProp {meta.coolprop_version} · {meta.backend}</span>}
      {eos && (
        <span className={`min-w-0 ${item}`} title={`Equations of state: ${eos}`}>
          {eos}
        </span>
      )}
      <span className={`ml-auto max-w-[50%] shrink-0 ${item}`} title={gaugeDetail}>
        {gauge}
      </span>
    </footer>
  )
}
