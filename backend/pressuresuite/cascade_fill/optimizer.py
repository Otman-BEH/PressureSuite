"""Auto-optimizer: the cascade sequence that wastes the least gas exergy.

Search space: passes separated by cool-downs (cool-downs only in the adiabatic
models). Within a pass, sources are connected in ascending pressure order (the
cascade principle) and each can be included or skipped. Destroyed exergy only
grows along a path, so it is used as a branch-and-bound lower bound.

A plan is valid when every source except the one that completes the fill
raises the COPV's settled pressure by at least `min_gain_bar` in total, which
stops the optimizer from opening a source for a tiny gain.

Ranking: fewest cool-downs first (each one means waiting for the COPV to cool,
so they are only used when the target cannot be reached otherwise; the search
deepens one cool-down at a time). Then valid plans by wasted exergy (including
the final cool-down); plans within 0.5 % of the best are ordered by fewest
sources opened, then fewest connections.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

from .engine import FillState, connect, cooldown, pressure
from .models import OptimizeRequest, OptimizeResponse, PlanOut, SequenceItem
from .simulate import Scenario

COOL = "~cooldown"
KEEP = 5  # plans kept for ranking / alternatives
TIE = 0.005  # relative exergy difference treated as a tie
PRUNE_MARGIN = 0.02  # branches this much worse than the best plan so far are not explored
SKIP_ROUNDS = (1, 2, math.inf)  # sources a pass may pass over, widened round by round


class _OutOfBudget(Exception):
    pass


@dataclass
class _Plan:
    steps: tuple[str, ...]
    exergy: float
    distinct: int
    connections: int

    @property
    def key(self):
        return (self.distinct, self.connections, self.exergy)


SEARCH_INCREMENTS = 30  # coarse marching while ranking; the plans returned are re-run at full resolution
SEARCH_SECONDS = 3.0  # time budget for the branch-and-bound (the narrow first round usually finishes well inside it)


def optimize(req: OptimizeRequest, budget: int | None = None, seconds: float = SEARCH_SECONDS) -> OptimizeResponse:
    sc = Scenario(req.settings, req.copv, req.sources, increments=SEARCH_INCREMENTS, heat_exchanger=req.heat_exchanger)
    ctx = sc.ctx
    pool = [sid for sid in sc.usable if req.source_ids is None or sid in req.source_ids]
    if not pool:
        return OptimizeResponse(best=None, alternatives=[], feasible=False, search_complete=True, evaluated_steps=0,
                                message=f"No {req.copv.fluid} sources in the pool.")

    adiabatic = ctx.mode != "isothermal"
    pass_limit = 1 + (req.max_cooldowns if adiabatic else 0)
    min_gain = req.min_gain_bar * 1e5
    if budget is None:
        budget = 200_000  # connection steps; the time budget normally ends the search first
    deadline = time.monotonic() + seconds
    Vc = ctx.copv_volume

    valid: list[_Plan] = []
    seen: set[tuple[str, ...]] = set()
    best_invalid: _Plan | None = None
    best_partial: tuple[float, float, tuple[str, ...]] = (-math.inf, 0.0, ())  # (copv mass, -exergy, steps)
    evaluated = 0

    def src_pressure(state: FillState, sid: str) -> float:
        return pressure(ctx, state.sources[sid], ctx.source_volumes[sid])

    def ascending(state: FillState) -> list[str]:
        return sorted(pool, key=lambda sid: src_pressure(state, sid))

    def bound() -> float:
        """Prune branches already worse than the best plan by more than PRUNE_MARGIN (or than the KEEP-th)."""
        if not valid:
            return math.inf
        b = valid[0].exergy * (1 + PRUNE_MARGIN)
        return min(b, valid[KEEP - 1].exergy) if len(valid) >= KEEP else b

    def twin_key(state: FillState, sid: str) -> tuple:
        v = state.sources[sid]
        return ctx.source_volumes[sid], round(v.m, 9), round(v.T, 6)

    def finish(state: FillState, steps: tuple[str, ...], x: float, contrib: dict[str, float], finisher: str):
        nonlocal best_invalid
        if steps in seen:  # the greedy pre-pass and the search can reach the same plan
            return
        seen.add(steps)
        _, settle = cooldown(ctx, state)
        connections = sum(1 for s in steps if s != COOL)
        plan = _Plan(steps, x + settle.exergy_destroyed, len(contrib), connections)
        if all(g >= min_gain - 1e-6 for sid, g in contrib.items() if sid != finisher):
            valid.append(plan)
            valid.sort(key=lambda p: p.exergy)
            del valid[KEEP * 2:]
        elif best_invalid is None or plan.exergy < best_invalid.exergy:
            best_invalid = plan

    def dfs(state: FillState, steps: tuple[str, ...], order: list[str], start: int,
            x: float, contrib: dict[str, float], passes: int, max_passes: int, skips: int, max_skips: float):
        """`skips`: sources passed over in this pass so far; branches skipping more than `max_skips` are cut."""
        nonlocal evaluated, best_partial
        if evaluated >= budget or time.monotonic() > deadline:
            raise _OutOfBudget
        if x >= bound():
            return
        best_partial = max(best_partial, (state.copv.m, -x, steps))
        p_copv = pressure(ctx, state.copv, Vc)
        skipped: set[tuple] = set()  # identical vessels skipped here: taking a twin instead repeats a branch
        for j in range(start, len(order)):
            sid = order[j]
            if src_pressure(state, sid) <= p_copv:
                continue
            key = twin_key(state, sid)
            if key in skipped:
                continue
            if skips + len(skipped) > max_skips:
                break
            skipped.add(key)
            new, rec = connect(ctx, state, sid)
            evaluated += 1
            if rec.dm <= 0:
                continue
            c2 = dict(contrib)
            c2[sid] = c2.get(sid, 0.0) + rec.settled_gain
            if rec.status == "target_reached":
                finish(new, steps + (sid,), x + rec.exergy_destroyed, c2, sid)
            else:
                dfs(new, steps + (sid,), order, j + 1, x + rec.exergy_destroyed, c2, passes, max_passes,
                    skips + len(skipped) - 1, max_skips)
        if steps and steps[-1] != COOL and passes < max_passes:
            new, rec = cooldown(ctx, state)
            dfs(new, steps + (COOL,), ascending(new), 0, x + rec.exergy_destroyed, contrib, passes + 1, max_passes,
                0, max_skips)

    def greedy(max_passes: int) -> bool:
        """Connect every source that can still push gas, in ascending order, cooling down
        between passes. Uses the most gas per pass, so it tells how many cool-downs are needed."""
        nonlocal evaluated, best_partial
        state, steps, x, contrib = sc.initial, (), 0.0, {}
        for passes in range(1, max_passes + 1):
            if passes > 1:
                if steps[-1:] == (COOL,):
                    break  # the last pass moved no gas; more cool-downs will not help
                state, rec = cooldown(ctx, state)
                steps, x = steps + (COOL,), x + rec.exergy_destroyed
            for sid in ascending(state):
                if src_pressure(state, sid) <= pressure(ctx, state.copv, Vc):
                    continue
                state, rec = connect(ctx, state, sid)
                evaluated += 1
                if rec.dm <= 0:
                    continue
                steps, x = steps + (sid,), x + rec.exergy_destroyed
                contrib[sid] = contrib.get(sid, 0.0) + rec.settled_gain
                if rec.status == "target_reached":
                    finish(state, steps, x, contrib, sid)
                    return True
        best_partial = max(best_partial, (state.copv.m, -x, steps))
        return False

    # Most of a full search is spent on branches that skip several sources and never reach the target,
    # so search in widening rounds: at most 1, then 2 skipped sources per pass, then everything. The
    # cheap rounds find near-optimal plans quickly; later rounds only improve on them while time allows.
    needed = next((n for n in range(1, pass_limit + 1) if greedy(n)), None)
    complete, covered = True, 0
    if needed is not None:
        for max_passes in range(needed, pass_limit + 1):
            try:
                for max_skips in SKIP_ROUNDS:
                    dfs(sc.initial, (), ascending(sc.initial), 0, 0.0, {}, 1, max_passes, 0, max_skips)
                    covered = max_skips
            except _OutOfBudget:
                complete = False
                break
            if valid:
                break

    def to_out(plan_steps: tuple[str, ...], meets: bool) -> PlanOut:
        sequence = [SequenceItem(type="cooldown") if s == COOL else SequenceItem(type="source", source_id=s)
                    for s in plan_steps]
        # Re-run at full resolution so the numbers match a manual simulation.
        result = Scenario(req.settings, req.copv, req.sources, heat_exchanger=req.heat_exchanger).run(sequence)
        return PlanOut(sequence=sequence, summary=result.summary, meets_min_gain=meets)

    if complete:
        search_note = ""
    elif covered:
        search_note = (f" Checked every plan that skips up to {covered} source{'s' if covered > 1 else ''} per pass;"
                       " the wider search ran out of time.")
    else:
        search_note = f" Search stopped after {evaluated} steps; best plan found so far."
    if valid:
        near = [p for p in valid if p.exergy <= valid[0].exergy * (1 + TIE)]
        best = min(near, key=lambda p: p.key)
        others = [p for p in valid if p is not best][: KEEP - 1]
        return OptimizeResponse(
            best=to_out(best.steps, True),
            alternatives=[to_out(p.steps, True) for p in others],
            feasible=True, search_complete=complete, evaluated_steps=evaluated,
            message="Least wasteful cascade found." + search_note,
        )
    if best_invalid is not None:
        return OptimizeResponse(
            best=to_out(best_invalid.steps, False), alternatives=[], feasible=True, search_complete=complete,
            evaluated_steps=evaluated,
            message=(f"No plan gets every source to add at least {req.min_gain_bar:g} bar; "
                     "showing the least wasteful plan that reaches the target." + search_note),
        )
    partial = to_out(best_partial[2], False) if best_partial[2] else None
    reach = f" Best achievable: {partial.summary.copv_settled.pressure_barg:.1f} barg settled." if partial else ""
    return OptimizeResponse(
        best=partial, alternatives=[], feasible=False, search_complete=complete, evaluated_steps=evaluated,
        message="The target cannot be reached with this pool." + reach + search_note,
    )
