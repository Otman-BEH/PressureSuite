import { cToK, fmt, MODES } from '../format'
import { useStore } from '../store'
import type { HistoryEntry, Mode, View } from '../types'
import type { Scenario } from '../store'
import { FileActions } from '../../../shared/files'
import { BarControl } from '../../../shared/ToolLayout'
import { Button, NumberField, Segmented, Switch } from '../../../shared/ui'

/** Fill methods offered by the tab. Cascade fill is the only one for now; others slot in here. */
type FillMethod = 'cascade'
const FILL_METHODS: { value: FillMethod; label: string; title: string }[] = [
  { value: 'cascade', label: 'Cascade fill', title: 'Fill the COPV from a cascade of bundles and bottles, with optional pumps' },
]

/** Tool-wide settings shown in the tool bar: fill method, ambient temperature, thermodynamic model, mode and time estimate. */
export function CascadeControls() {
  const settings = useStore((s) => s.settings)
  const view = useStore((s) => s.view)
  const timeOn = useStore((s) => s.timeModel.enabled)
  const { setAmbient, setMode, setView, setTimeModel, openEditor } = useStore.getState()

  return (
    <>
      <BarControl label="Method">
        <Segmented<FillMethod> label="Fill method" value="cascade" onChange={() => {}} options={FILL_METHODS} />
      </BarControl>
      <BarControl label="Ambient">
        <NumberField value={settings.ambientTempC} onChange={setAmbient} min={-60} max={80} unit="°C" className="w-24" />
        <span className="hidden font-mono text-small whitespace-nowrap text-muted 2xl:inline">= {fmt(cToK(settings.ambientTempC), 2)} K</span>
      </BarControl>
      <BarControl label="Model" title={MODES[settings.mode].hint}>
        <Segmented<Mode>
          label="Thermodynamic model"
          value={settings.mode}
          onChange={setMode}
          options={(Object.keys(MODES) as Mode[]).map((m) => ({ value: m, label: MODES[m].label, title: MODES[m].hint }))}
        />
      </BarControl>
      <BarControl label="Mode">
        <Segmented<View>
          label="Mode"
          value={view}
          onChange={setView}
          options={[
            { value: 'manual', label: 'Manual sequence' },
            { value: 'optimize', label: 'Auto-optimize' },
          ]}
        />
      </BarControl>
      <BarControl label="Time estimate">
        <Switch checked={timeOn} onChange={(enabled) => setTimeModel({ enabled })} label="Time estimate" />
        <Button variant="quiet" onClick={() => openEditor('time')}>
          Settings
        </Button>
      </BarControl>
    </>
  )
}

/** Export / Import / Reset of the whole scenario (inventory, sequence, equipment and fill history). */
export function CascadeFileActions() {
  const { resetAll, importScenario } = useStore.getState()

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
    <FileActions
      onExport={exportScenario}
      onImport={importFile}
      resetPrompt="Reset the scenario, inventory and fill history?"
      onReset={resetAll}
      exportTitle="Save the scenario, inventory and fill history to a file"
    />
  )
}
