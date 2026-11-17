import { Fragment } from 'react'
import { api, scenarioPayload } from '../api'
import { fmt, sourceName } from '../format'
import { parallelCount, useStore } from '../store'
import type { PlanOut } from '../types'
import { ArrowRight, CooldownIcon } from './icons'
import { Chip, NumberField, Panel } from './ui'

function PlanSteps({ plan }: { plan: PlanOut }) {
  const sources = useStore((s) => s.sources)
  const labels = new Map(sources.map((s) => [s.id, sourceName(s)]))
  return (
    <div className="flex flex-wrap items-center gap-1">
      {plan.sequence.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <ArrowRight className="size-3.5 text-slate-300" />}
          {it.type === 'cooldown' ? (
            <Chip className="bg-cyan-50 text-cyan-800 ring-cyan-200">
              <CooldownIcon className="size-3" /> Cool-down
            </Chip>
          ) : (
            <Chip className="bg-slate-50 text-slate-800 ring-slate-200">{labels.get(it.source_id ?? '') ?? '?'}</Chip>
          )}
        </Fragment>
      ))}
    </div>
  )
}

function PlanMetrics({ plan, isothermal }: { plan: PlanOut; isothermal: boolean }) {
  const s = plan.summary
  const items: [string, string][] = [
    ['Settled', `${fmt(s.copv_settled.pressure_barg)} barg`],
    ['Sources opened', `${s.sources_opened}`],
    ['Connections', `${s.connections}`],
    ['Cool-downs', `${s.cooldowns}`],
    ['Wasted exergy', `${fmt(s.wasted_exergy_kj, 0)} kJ`],
    ['Gas moved', `${fmt(s.delivered_kg, 2)} kg`],
  ]
  if (!isothermal) items.splice(1, 0, ['Peak gas temp.', `${fmt(s.peak_gas_temp_c)} °C`])
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs sm:grid-cols-4 lg:grid-cols-7">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] text-slate-500">{k}</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function OptimizerPanel() {
  const settings = useStore((s) => s.settings)
  const copv = useStore((s) => s.copv)
  const sources = useStore((s) => s.sources)
  const excluded = useStore((s) => s.excluded)
  const minGainBar = useStore((s) => s.minGainBar)
  const maxCooldowns = useStore((s) => s.maxCooldowns)
  const opt = useStore((s) => s.opt)
  const { setMinGain, setMaxCooldowns, setOpt, applyPlan } = useStore.getState()

  const isothermal = settings.mode === 'isothermal'
  const pool = sources.filter((s) => s.fluid === copv.fluid && !excluded.includes(s.id))
  const parallel = useStore((s) => parallelCount(s.manifold))
  const payload = scenarioPayload(settings, copv, sources, parallel)
  const inputKey = JSON.stringify([payload, pool.map((s) => s.id), minGainBar, maxCooldowns])
  const stale = opt.result !== null && opt.inputKey !== inputKey

  const run = async () => {
    setOpt({ loading: true, error: null })
    try {
      const result = await api.optimize(payload, useStore.getState().heatExchanger, { sourceIds: pool.map((s) => s.id), minGainBar, maxCooldowns })
      setOpt({ result, loading: false, inputKey })
    } catch (e) {
      setOpt({ loading: false, error: (e as Error).message })
    }
  }

  const res = opt.result
  return (
    <Panel className="h-full" title="Auto-optimize" aside={<span className="text-[11px] text-slate-500">Uses the checked sources in the inventory</span>}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-600">
          Lowest-pressure sources first, keeping high-pressure gas for later fills; a source that would add less than the minimum gain
          is skipped.{!isothermal && ' Cool-downs only when the target needs them.'}{' '}
          <span className="text-slate-400" title="Waste = destroyed exergy: the work potential lost when gas throttles across a pressure difference or hot gas cools.">
            (ranked by wasted exergy)
          </span>
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            className="w-44"
            label="Min. gain per source"
            value={minGainBar}
            onChange={setMinGain}
            min={0}
            max={500}
            unit="bar"
            title="A source (other than the one that completes the fill) must raise the COPV's settled pressure by at least this much."
          />
          {!isothermal && (
            <NumberField className="w-36" label="Max. cool-downs" value={maxCooldowns} onChange={(n) => setMaxCooldowns(Math.round(n))} min={0} max={10} digits={0} />
          )}
          <button
            type="button"
            onClick={run}
            disabled={opt.loading || pool.length === 0}
            className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {opt.loading ? 'Optimizing…' : `Optimize with ${pool.length} source${pool.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {opt.error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">{opt.error}</p>}
        {stale && <p className="text-xs text-amber-700">Inputs changed since this result. Run the optimizer again.</p>}

        {res && (
          <div className={`flex flex-col gap-3 ${stale ? 'opacity-60' : ''}`}>
            <p className={`text-xs ${res.feasible ? 'text-slate-600' : 'text-amber-800'}`}>{res.message}</p>
            {res.best && (
              <div className="rounded-xl bg-emerald-50/50 p-3 ring-1 ring-emerald-200">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{res.feasible ? 'Recommended sequence' : 'Best effort'}</span>
                  <button
                    type="button"
                    onClick={() => applyPlan(res.best!.sequence)}
                    className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    Use this sequence
                  </button>
                </div>
                <PlanSteps plan={res.best} />
                <div className="mt-3">
                  <PlanMetrics plan={res.best} isothermal={isothermal} />
                </div>
              </div>
            )}
            {res.alternatives.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase">Runner-up plans</h3>
                {res.alternatives.map((plan, i) => (
                  <div key={i} className="rounded-lg p-3 ring-1 ring-slate-200">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <PlanSteps plan={plan} />
                      <button type="button" onClick={() => applyPlan(plan.sequence)} className="text-xs font-medium text-sky-700 hover:underline">
                        Use
                      </button>
                    </div>
                    <PlanMetrics plan={plan} isothermal={isothermal} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
