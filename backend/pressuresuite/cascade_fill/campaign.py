"""Test campaign forecast: fill several COPVs in a row from the same inventory.

Each fill (one COPV, or several in parallel on the manifold) uses the optimizer's
recommended cascade (valves only; pumps are manual), then the gas is vented or
recovered as set. Every source carries its leftover gas into the next fill, back
at ambient temperature.
"""

from __future__ import annotations

from .models import CampaignFill, CampaignRequest, CampaignResponse, OptimizeRequest, PoolLevel
from .optimizer import optimize
from .simulate import Scenario


def campaign(req: CampaignRequest) -> CampaignResponse:
    sources = list(req.sources)
    fills: list[CampaignFill] = []
    pool_start = None
    adiabatic = req.settings.mode != "isothermal"
    usable = {s.id for s in sources if s.fluid == req.copv.fluid and (req.source_ids is None or s.id in req.source_ids)}

    remaining, i = req.count, 0
    while remaining > 0:
        i += 1
        copv = req.copv.model_copy(update={"parallel": min(req.copv.parallel, remaining)})  # last round may be smaller
        opt_req = OptimizeRequest(settings=req.settings, copv=copv, sources=sources,
                                  heat_exchanger=req.heat_exchanger, source_ids=req.source_ids,
                                  min_gain_bar=req.min_gain_bar, max_cooldowns=req.max_cooldowns)
        opt = optimize(opt_req, seconds=1.5 if adiabatic else 1.0)
        sequence = opt.best.sequence if opt.best else []
        result = Scenario(req.settings, copv, sources, equipment=req.equipment, heat_exchanger=req.heat_exchanger,
                          after_test=req.after_test, time_model=req.time_model).run(sequence)
        remaining -= copv.parallel
        if pool_start is None:
            pool_start = sum(r.start.mass_kg for r in result.sources if r.id in usable)
        reached = opt.feasible and result.summary.target_reached
        pool_after = [PoolLevel(id=r.id, pressure_ref_barg=max(r.pressure_ref_barg, 0.0), mass_kg=r.end.mass_kg)
                      for r in result.sources]
        fills.append(CampaignFill(index=i, copvs=copv.parallel, feasible=reached, sequence=sequence,
                                  summary=result.summary, pool_after=pool_after, message=opt.message))
        if not reached:
            break
        levels = {p.id: p.pressure_ref_barg for p in pool_after}
        sources = [s.model_copy(update={"pressure_barg": levels[s.id]}) for s in sources]

    completed = sum(f.copvs for f in fills if f.feasible)
    if completed == req.count:
        message = f"Enough gas for all {req.count} COPV{'s' if req.count > 1 else ''}."
    else:
        message = f"Gas runs out: enough for {completed} of {req.count} COPVs."
    total_time = None
    if req.time_model.enabled:
        total_time = sum(f.summary.time.total_min for f in fills if f.feasible and f.summary and f.summary.time)
    return CampaignResponse(count=req.count, completed=completed, pool_start_kg=pool_start or 0.0, fills=fills,
                            total_time_min=total_time, message=message)
