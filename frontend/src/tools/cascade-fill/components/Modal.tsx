import { useEffect, type ReactNode } from 'react'
import { useStore } from '../store'
import { Button, Switch } from '../../../shared/ui'
import { XIcon } from './icons'

export { Switch }

/** Centered property card over a dimmed page; Escape or a click outside closes it. */
export function Modal({ title, subtitle, icon, footer, children }: { title: string; subtitle: string; icon: ReactNode; footer: ReactNode; children: ReactNode }) {
  const close = () => useStore.getState().openEditor(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.getState().openEditor(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/30 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="flex w-full max-w-md flex-col gap-4 border border-rule-strong bg-surface p-4 shadow-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <h2 id="editor-title" className="text-base font-semibold text-ink">
                {title}
              </h2>
              <p className="text-small text-muted">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-control p-1 text-muted hover:bg-bg hover:text-ink">
            <XIcon className="size-4" />
          </button>
        </header>
        {children}
        <footer className="flex items-center justify-between">
          {footer}
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  )
}

export function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-small font-semibold tracking-wide text-muted uppercase">{title}</legend>
      <div className="grid grid-cols-2 gap-2">{children}</div>
      {note && <p className="text-small text-muted">{note}</p>}
    </fieldset>
  )
}

