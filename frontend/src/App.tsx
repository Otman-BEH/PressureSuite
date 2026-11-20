import { Suspense, useEffect, useState } from 'react'
import { StatusBar } from './shared/StatusBar'
import { TOOLS, type Tool } from './tools'

/** The active tool comes from the URL hash (#/cascade-fill), so refreshes and links keep the tab. */
function toolFromHash(): Tool {
  const id = window.location.hash.replace(/^#\/?/, '')
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0]
}

function useActiveTool(): [Tool, (id: string) => void] {
  const [tool, setTool] = useState(toolFromHash)
  useEffect(() => {
    const onHashChange = () => setTool(toolFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return [tool, (id) => (window.location.hash = `/${id}`)]
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
      <rect x="4" y="4" width="24" height="24" fill="var(--color-ink)" />
      <rect x="9" y="17" width="14" height="6" fill="var(--color-accent)" />
    </svg>
  )
}

export default function App() {
  const [active, select] = useActiveTool()
  const ActiveTool = active.component

  useEffect(() => {
    document.title = `${active.name} · Pressure Suite`
  }, [active])

  return (
    <div className="flex min-h-screen flex-col bg-bg pb-6 text-ink">
      <nav className="flex h-10 items-stretch gap-8 border-b border-rule bg-surface px-3">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-body font-semibold tracking-[0.08em] whitespace-nowrap text-ink">PRESSURE SUITE</span>
        </div>
        <div role="tablist" aria-label="Tools" className="flex items-stretch gap-5">
          {TOOLS.map((t) => {
            const selected = t.id === active.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={t.description}
                onClick={() => select(t.id)}
                className={`relative px-0.5 text-body whitespace-nowrap focus-visible:-outline-offset-2 ${
                  selected ? 'font-semibold text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {t.name}
              </button>
            )
          })}
        </div>
      </nav>
      <Suspense fallback={<p className="p-3 text-small text-muted">Loading {active.name}…</p>}>
        <ActiveTool key={active.id} />
      </Suspense>
      <StatusBar gauge={active.gauge} gaugeDetail={active.gaugeDetail} />
    </div>
  )
}
