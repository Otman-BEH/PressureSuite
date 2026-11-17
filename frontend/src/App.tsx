import { Suspense, useEffect, useState } from 'react'
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
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <rect x="9" y="2" width="14" height="28" rx="7" fill="#2a78d6" />
      <rect x="12.5" y="7" width="3" height="16" rx="1.5" fill="white" opacity="0.4" />
    </svg>
  )
}

export default function App() {
  const [active, select] = useActiveTool()
  const ActiveTool = active.component

  useEffect(() => {
    document.title = `${active.name} · pressuresuite`
  }, [active])

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <nav className="flex items-end gap-6 bg-slate-900 px-5 pt-2.5">
        <div className="flex items-center gap-2 pb-2.5">
          <Logo />
          <span className="text-base font-semibold tracking-tight text-white">pressuresuite</span>
        </div>
        <div role="tablist" aria-label="Tools" className="flex gap-1">
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
                className={
                  selected
                    ? 'rounded-t-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900'
                    : 'rounded-t-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white'
                }
              >
                {t.name}
              </button>
            )
          })}
        </div>
      </nav>
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading {active.name}…</p>}>
        <ActiveTool key={active.id} />
      </Suspense>
    </div>
  )
}
