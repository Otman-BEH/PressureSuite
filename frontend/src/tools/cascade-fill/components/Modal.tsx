import { useEffect, type ReactNode } from 'react'
import { useStore } from '../store'
import { XIcon } from './icons'

/** Centered property card over a dimmed page; Escape or a click outside closes it. */
export function Modal({ title, subtitle, icon, footer, children }: { title: string; subtitle: string; icon: ReactNode; footer: ReactNode; children: ReactNode }) {
  const close = () => useStore.getState().openEditor(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.getState().openEditor(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/30 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <h2 id="editor-title" className="text-base font-semibold text-slate-900">
                {title}
              </h2>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <XIcon className="size-4" />
          </button>
        </header>
        {children}
        <footer className="flex items-center justify-between">
          {footer}
          <button type="button" onClick={close} className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-900">
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

export function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{title}</legend>
      <div className="grid grid-cols-2 gap-2">{children}</div>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </fieldset>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-sky-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}
