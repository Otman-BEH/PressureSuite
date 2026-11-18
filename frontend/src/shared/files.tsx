import { useRef } from 'react'

/**
 * Saving a tool's inputs to a file and loading them back, so a test setup can be reused. Fully offline: the browser
 * downloads the JSON and reads the chosen file locally.
 */

export interface SavedInputs {
  tool: string
  saved: string
  inputs: unknown
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const btn = 'rounded-md px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-slate-900'

/** Export · Import · Reset for a tool's inputs; Reset asks first. */
export function ToolActions({ tool, title, inputs, onImport, onReset }: {
  tool: string
  title: string
  inputs: unknown
  onImport: (inputs: unknown) => void
  onReset: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const exportInputs = () => {
    const day = new Date().toISOString().slice(0, 10)
    downloadJson(`${tool}-${day}.json`, { tool, saved: new Date().toISOString(), inputs } satisfies SavedInputs)
  }
  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Partial<SavedInputs>
      if (data.tool !== tool || !data.inputs || typeof data.inputs !== 'object') {
        throw new Error(data.tool ? `this file is for the ${data.tool} tab` : 'not a saved settings file')
      }
      onImport(data.inputs)
    } catch (e) {
      alert(`Could not import: ${(e as Error).message}`)
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-sm font-semibold text-slate-700">{title}</span>
      <div className="flex gap-1.5">
        <button type="button" className={btn} onClick={exportInputs} title="Save these inputs to a file">
          Export
        </button>
        <button type="button" className={btn} onClick={() => file.current?.click()} title="Load inputs saved with Export">
          Import
        </button>
        <button type="button" className={btn} onClick={() => confirm(`Reset all ${title} inputs to the defaults?`) && onReset()}>
          Reset
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
