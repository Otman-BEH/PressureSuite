import { useRef } from 'react'
import { cToK, fmt, MODES } from '../format'
import { useStore } from '../store'
import type { HistoryEntry, Mode, View } from '../types'
import type { Scenario } from '../store'
import { Switch } from './Modal'
import { NumberField, Segmented } from './ui'

export function TopBar() {
  const settings = useStore((s) => s.settings)
  const view = useStore((s) => s.view)
  const timeOn = useStore((s) => s.timeModel.enabled)
  const { setAmbient, setMode, setView, resetAll, importScenario, setTimeModel, openEditor } = useStore.getState()
  const fileInput = useRef<HTMLInputElement>(null)

  const exportScenario = () => {
    const { settings, copv, sources, sequence, equipment, heatExchanger, manifold, afterTest, timeModel, copvCount, history } = useStore.getState()
    const scenario = { settings, copv, sources, sequence, equipment, heatExchanger, manifold, afterTest, timeModel, copvCount, history }
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `copv-fill-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<Scenario> & { history?: HistoryEntry[] }
      if (!Array.isArray(data.sources) || !data.copv) throw new Error('Not a scenario file')
      importScenario(data)
    } catch (e) {
      alert(`Could not import: ${(e as Error).message}`)
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-200 bg-white px-5 py-3">
      <div className="flex items-center gap-3 rounded-xl bg-orange-50 px-3 py-1.5 ring-1 ring-orange-200">
        <svg viewBox="0 0 24 24" className="size-6 text-orange-600" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 13.5V5a2 2 0 114 0v8.5a4 4 0 11-4 0z" />
          <path d="M12 9v6" />
        </svg>
        <div>
          <div className="text-[11px] font-semibold tracking-wide text-orange-800 uppercase">Ambient temperature</div>
          <div className="flex items-center gap-2">
            <NumberField
              value={settings.ambientTempC}
              onChange={setAmbient}
              min={-60}
              max={80}
              unit="°C"
              className="w-28"
              inputClassName="text-lg font-semibold"
            />
            <span className="text-lg font-semibold text-slate-700 tabular-nums">= {fmt(cToK(settings.ambientTempC), 2)} K</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Thermodynamic model</span>
        <Segmented<Mode>
          label="Thermodynamic model"
          value={settings.mode}
          onChange={setMode}
          options={(Object.keys(MODES) as Mode[]).map((m) => ({ value: m, label: MODES[m].label, title: MODES[m].hint }))}
        />
        <span className="max-w-md text-[11px] text-slate-500">{MODES[settings.mode].hint}</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Mode</span>
        <Segmented<View>
          label="Mode"
          value={view}
          onChange={setView}
          options={[
            { value: 'manual', label: 'Manual sequence' },
            { value: 'optimize', label: 'Auto-optimize' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Time estimate</span>
        <div className="flex h-8 items-center gap-2">
          <Switch checked={timeOn} onChange={(enabled) => setTimeModel({ enabled })} label="Time estimate" />
          <span className="text-sm text-slate-700">{timeOn ? 'On' : 'Off'}</span>
          <button type="button" onClick={() => openEditor('time')} className="text-xs text-sky-700 hover:underline">
            Settings
          </button>
        </div>
      </div>

      <div className="ml-auto flex gap-2">
        <button type="button" onClick={exportScenario} className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          Export
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          Import
        </button>
        <button
          type="button"
          onClick={() => confirm('Reset the scenario, inventory and fill history?') && resetAll()}
          className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          Reset
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) importFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
