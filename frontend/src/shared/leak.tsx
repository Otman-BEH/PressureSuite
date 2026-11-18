import { fmt, fmtP, fmtSig } from './format'
import { request } from './http'
import { useStoredFlag } from './storage'
import { LinkButton, Notes, NumberField, Panel, type Note } from './ui'
import { useCalculation } from './useCalculation'
import { wallPayload, type WallSpec } from './wall'

/**
 * Leak rate sidebar panel, used on the test tabs (not a tab of its own). The leak rate is an output: give the start
 * and end pressure of a hold and its length, and it returns the decay in bar/min, plus the mass lost and the equivalent
 * flow for the vessel and fluid of the tab it sits on. Until the user types a start pressure it follows the first
 * cycle's target. The same calculation runs per cycle when a cycle has a measured end-of-hold pressure.
 */

export interface LeakSettings {
  /** null: follow the first cycle's target */
  startBarg: number | null
  /** null: 1 bar below the start */
  endBarg: number | null
  holdMin: number
}

export const defaultLeak = (): LeakSettings => ({ startBarg: null, endBarg: null, holdMin: 10 })

/** Saved settings from an older version (which had an input leak rate and unit) made valid. */
export function upgradeLeak(saved: Partial<LeakSettings> | undefined): LeakSettings {
  return { startBarg: saved?.startBarg ?? null, endBarg: saved?.endBarg ?? null, holdMin: saved?.holdMin ?? 10 }
}

export interface LeakContext {
  fluid: string
  volumeL: number
  tempC: number
  wall: WallSpec | null
  /** The first cycle's target, used as the start pressure until the user sets one. */
  suggestedStartBarg: number
}

interface LeakResponse {
  phase: 'gas' | 'liquid'
  rate_bar_min: number
  drop_bar: number
  lost_kg: number
  mass_rate_g_min: number
  flows: { unit: string; value: number }[]
  notes: Note[]
}

export function LeakPanel({ tool, context, settings, onChange }: {
  tool: string
  context: LeakContext
  settings: LeakSettings
  onChange: (patch: Partial<LeakSettings>) => void
}) {
  const [open, setOpen] = useStoredFlag(`${tool}:leak-open`, true)
  const start = settings.startBarg ?? context.suggestedStartBarg
  const end = settings.endBarg ?? Math.max(0, start - 1)
  const following = settings.startBarg === null
  const payload = {
    fluid: context.fluid,
    volume_l: context.volumeL,
    temp_c: context.tempC,
    wall: context.wall ? wallPayload(context.wall) : null,
    start_barg: start,
    end_barg: end,
    hold_min: settings.holdMin,
  }
  const { result, error } = useCalculation(JSON.stringify(payload), (signal) => request<LeakResponse>('/api/leak/calculate', payload, signal))
  return (
    <Panel
      title="Leak rate check"
      collapsed={!open}
      onToggle={() => setOpen(!open)}
      collapsedAside={result && <span className="text-xs text-slate-600 tabular-nums">{fmtSig(result.rate_bar_min)} bar/min</span>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-slate-500">One hold: start and end pressure and how long it took.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Start pressure"
            unit="barg"
            value={start}
            min={0.01}
            max={20_000}
            digits={3}
            hint={following ? 'first cycle target' : undefined}
            onChange={(startBarg) => onChange({ startBarg })}
          />
          <NumberField label="End pressure" unit="barg" value={end} min={0} max={20_000} digits={3} onChange={(endBarg) => onChange({ endBarg })} />
          <NumberField label="Hold time" unit="min" value={settings.holdMin} min={0.01} max={1_000_000} digits={1} onChange={(holdMin) => onChange({ holdMin })} />
          {!following && (
            <div className="flex items-end">
              <LinkButton onClick={() => onChange({ startBarg: null, endBarg: null })} title={`Start from the first cycle target (${fmtP(context.suggestedStartBarg)} barg)`}>
                Use cycle target
              </LinkButton>
            </div>
          )}
        </div>
        {result && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <div className="text-slate-700">
              Leak rate <span className="font-semibold text-slate-900 tabular-nums">{fmtSig(result.rate_bar_min)} bar/min</span>
            </div>
            <div className="text-xs text-slate-500 tabular-nums">
              −{fmt(result.drop_bar, result.drop_bar < 0.1 ? 4 : 3)} bar ·{' '}
              {result.phase === 'liquid' ? `${fmtSig((result.flows[0]?.value ?? 0) * settings.holdMin)} mL lost` : `${fmtSig(result.lost_kg * 1e3)} g lost`}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">≈ {result.flows.map((f) => `${fmtSig(f.value)} ${f.unit}`).join(' · ')}</div>
          </div>
        )}
        <p className="text-[11px] text-slate-500">For every test hold, turn on "Record readings" in the cycle table.</p>
        <Notes error={error} notes={result?.notes} withAssumptions />
      </div>
    </Panel>
  )
}
