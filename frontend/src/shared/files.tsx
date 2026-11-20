import { useRef } from 'react'
import { Button } from './ui'

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

/** Export · Import · Reset buttons, always in this order at the right of the tool bar. Reset asks first. */
export function FileActions({ onExport, onImport, resetPrompt, onReset, exportTitle = 'Save these inputs to a file' }: {
  onExport: () => void
  onImport: (file: File) => void
  resetPrompt: string
  onReset: () => void
  exportTitle?: string
}) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="flex gap-1.5">
      <Button onClick={onExport} title={exportTitle}>
        Export
      </Button>
      <Button onClick={() => file.current?.click()} title="Load inputs saved with Export">
        Import
      </Button>
      <Button onClick={() => confirm(resetPrompt) && onReset()}>Reset</Button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** File actions for a calculator tool whose inputs are one object saved as { tool, saved, inputs }. */
export function ToolActions({ tool, title, inputs, onImport, onReset }: {
  tool: string
  title: string
  inputs: unknown
  onImport: (inputs: unknown) => void
  onReset: () => void
}) {
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
  return <FileActions onExport={exportInputs} onImport={importFile} resetPrompt={`Reset all ${title} inputs to the defaults?`} onReset={onReset} />
}
