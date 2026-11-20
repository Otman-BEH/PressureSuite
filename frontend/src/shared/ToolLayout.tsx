import type { ReactNode } from 'react'

/**
 * The one layout every tool uses (DESIGN.md, "App shell"): a tool bar with the tool name on the left, optional
 * controls in the middle and the file actions on the right; below it a fixed-width inputs column and the results.
 * Panels stack inside each column, separated by their own rules.
 */
export function ToolLayout({ name, controls, actions, inputs, children }: {
  name: string
  /** Tool-wide controls that belong in the bar (e.g. COPV Fill's ambient temperature and model). */
  controls?: ReactNode
  /** Export / Import / Reset. */
  actions: ReactNode
  inputs: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 2xl:gap-x-6 border-b border-rule bg-surface px-3 py-1.5">
        <h1 className="text-body font-semibold whitespace-nowrap text-ink">{name}</h1>
        {controls}
        <div className="ml-auto">{actions}</div>
      </div>
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-rule bg-surface lg:w-80 lg:border-r lg:border-b-0">{inputs}</aside>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  )
}

/** A label and a control side by side, for controls that live in the tool bar. */
export function BarControl({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="text-label font-medium whitespace-nowrap text-muted uppercase">{label}</span>
      {children}
    </div>
  )
}
