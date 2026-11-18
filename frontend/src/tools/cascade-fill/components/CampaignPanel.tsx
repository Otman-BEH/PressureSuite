import { Fragment } from 'react'
import { api, equipmentPayload, scenarioPayload } from '../api'
import { fmt, fmtMin, sourceName } from '../format'
import { copvsDone, parallelCount, useStore } from '../store'
import type { CampaignFill } from '../types'
import { ArrowRight } from './icons'
import { Chip, Panel } from '../../../shared/ui'

const th = 'px-2 py-1.5 text-left text-[11px] font-medium text-slate-500 whitespace-nowrap'
const td = 'px-2 py-1.5 whitespace-nowrap tabular-nums'

function PlanCell({ fill, labels }: { fill: CampaignFill; labels: Map<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {fill.sequence.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <ArrowRight className="size-3 text-slate-300" />}
          <span className={it.type === 'cooldown' ? 'text-cyan-700' : 'text-slate-700'}>
            {it.type === 'cooldown' ? 'Cool-down' : (labels.get(it.source_id ?? '') ?? '?')}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/** "#3" or "#3–4" for the COPVs a forecast fill covers. */
function copvRange(done: number, fills: CampaignFill[], index: number): string {
  const first = done + fills.filter((f) => f.index < index).reduce((n, f) => n + f.copvs, 0) + 1
  const fill = fills.find((f) => f.index === index)
  const last = first + (fill?.copvs ?? 1) - 1
  return last > first ? `#${first}–${last}` : `#${first}`
}

export function CampaignPanel() {
  const settings = useStore((s) => s.settings)
  const copv = useStore((s) => s.copv)
  const sources = useStore((s) => s.sources)
  const excluded = useStore((s) => s.excluded)
  const equipment = useStore((s) => s.equipment)
  const heatExchanger = useStore((s) => s.heatExchanger)
  const afterTest = useStore((s) => s.afterTest)
  const timeModel = useStore((s) => s.timeModel)
  const minGainBar = useStore((s) => s.minGainBar)
  const maxCooldowns = useStore((s) => s.maxCooldowns)
  const count = useStore((s) => s.copvCount)
  const done = useStore((s) => copvsDone(s.history))
  const campaign = useStore((s) => s.campaign)
  const { setCampaign, newCampaign } = useStore.getState()

  const remaining = Math.max(count - done, 0)
  const pool = sources.filter((s) => s.fluid === copv.fluid && !excluded.includes(s.id))
  const parallel = useStore((s) => parallelCount(s.manifold))
  const payload = scenarioPayload(settings, copv, sources, parallel)
  const extras = equipmentPayload({ equipment, heatExchanger, afterTest, timeModel })
  const recovering = afterTest.action === 'recover'
  const timed = timeModel.enabled
  const inputKey = JSON.stringify([payload, extras, pool.map((s) => s.id), minGainBar, maxCooldowns, remaining])
  const stale = campaign.result !== null && campaign.inputKey !== inputKey
  const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
  const usable = new Set(pool.map((s) => s.id))

  const run = async () => {
    setCampaign({ loading: true, error: null })
    try {
      const result = await api.campaign(payload, extras, { sourceIds: pool.map((s) => s.id), minGainBar, maxCooldowns, count: remaining })
      setCampaign({ result, loading: false, inputKey })
    } catch (e) {
      setCampaign({ loading: false, error: (e as Error).message })
    }
  }

  const res = campaign.result
  return (
    <Panel
      title={
        <>
          Gas forecast <span className="font-normal text-slate-500">· {done} of {count} COPVs filled, {remaining} to go</span>
        </>
      }
      aside={
        <div className="flex items-center gap-3">
          {done > 0 && (
            <button
              type="button"
              onClick={() => confirm('Start a new campaign? This clears the fill history (the inventory stays as it is).') && newCampaign()}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              New campaign
            </button>
          )}
          <button
            type="button"
            onClick={run}
            disabled={campaign.loading || remaining === 0 || pool.length === 0}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {campaign.loading ? 'Checking…' : `Check gas for ${remaining} COPV${remaining === 1 ? '' : 's'}`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-600">
          Fills the remaining COPVs one after another with the optimizer's cascade (no pumps), {fmt(copv.leakPct)} % leak per test
          {afterTest.action === 'recover' ? ', gas recovered after each' : afterTest.action === 'vent' ? ', vented after each' : ''}.
        </p>
        {campaign.error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">{campaign.error}</p>}
        {stale && <p className="text-xs text-amber-700">Inputs changed since this forecast. Check again.</p>}
        {res && (
          <div className={`flex flex-col gap-3 ${stale ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-3">
              {res.completed === res.count ? (
                <Chip className="bg-emerald-50 px-3 py-1 text-sm text-emerald-800 ring-emerald-200">✓ {res.message}</Chip>
              ) : (
                <Chip className="bg-amber-50 px-3 py-1 text-sm text-amber-800 ring-amber-200">⚠ {res.message}</Chip>
              )}
              <span className="text-xs text-slate-500 tabular-nums">Inventory at start: {fmt(res.pool_start_kg, 1)} kg</span>
              {res.total_time_min !== null && (
                <span className="text-xs text-slate-700 tabular-nums">
                  Total time for {res.completed} COPV{res.completed === 1 ? '' : 's'}: <b>{fmtMin(res.total_time_min)}</b>
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-slate-700">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className={th}>COPV</th>
                    <th className={th}>Sequence</th>
                    <th className={`${th} text-right`}>Settled (barg)</th>
                    <th className={`${th} text-right`}>Gas delivered (kg)</th>
                    <th className={`${th} text-right`}>Leaked (kg)</th>
                    {recovering && <th className={`${th} text-right`}>Recovered (kg)</th>}
                    {timed && <th className={`${th} text-right`}>Cycle time</th>}
                    <th className={`${th} text-right`}>Inventory left (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {res.fills.map((f) => {
                    const left = f.pool_after.filter((p) => usable.has(p.id)).reduce((sum, p) => sum + p.mass_kg, 0)
                    return (
                      <tr key={f.index} className={f.feasible ? '' : 'bg-amber-50/60'}>
                        <td className={td}>
                          {copvRange(done, res.fills, f.index)} {f.feasible ? '✓' : '⚠ short'}
                        </td>
                        <td className="px-2 py-1.5">
                          <PlanCell fill={f} labels={labels} />
                        </td>
                        <td className={`${td} text-right`}>{f.summary ? fmt(f.summary.copv_settled.pressure_barg) : '–'}</td>
                        <td className={`${td} text-right`}>{f.summary ? fmt(f.summary.delivered_kg, 2) : '–'}</td>
                        <td className={`${td} text-right`}>{f.summary ? fmt(f.summary.leaked_kg, 2) : '–'}</td>
                        {recovering && <td className={`${td} text-right`}>{f.summary ? fmt(f.summary.recovered_kg, 2) : '–'}</td>}
                        {timed && <td className={`${td} text-right`}>{f.feasible && f.summary?.time ? fmtMin(f.summary.time.total_min) : '–'}</td>}
                        <td className={`${td} text-right`}>{fmt(left, 1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
