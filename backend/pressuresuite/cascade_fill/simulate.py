"""Builds a fill scenario from a request, runs a sequence and reports it."""

from __future__ import annotations

import math
from dataclasses import replace

from ..config import P_ATM, T_NORMAL, barg_to_pa, c_to_k, k_to_c, pa_to_barg
from .defaults import T_SOURCE_REF
from .engine import (
    Exchanger,
    exergy,
    FillContext,
    FillState,
    Machine,
    StepRecord,
    Timing,
    Vessel,
    connect,
    cooldown,
    fill_vessel,
    pressure,
    pump,
    recover,
    settled_pressure,
    vent,
)
from .models import (
    AfterTestIn,
    CopvIn,
    EquipmentIn,
    HeatExchangerIn,
    MachineIn,
    MachineKind,
    SequenceItem,
    Settings,
    SimulateRequest,
    SimulateResponse,
    SourceIn,
    SourceResult,
    StepOut,
    Summary,
    TimeBreakdown,
    TimeModelIn,
    TimelinePoint,
    TracePointOut,
    VesselView,
)
from ..thermo import get_fluid

MACHINE_NAMES: dict[MachineKind, str] = {"booster": "boost pump", "compressor": "compressor"}
GROUP = "~manifold"  # id of the combined vessel while bundles on a manifold are open together
DISCHARGE_COEFFICIENT = 0.8


def to_machine(m: MachineIn, rho_normal: float = 0.0) -> Machine:
    return Machine(
        inlet_min=barg_to_pa(m.inlet_min_barg),
        inlet_max=barg_to_pa(m.inlet_max_barg),
        outlet_max=barg_to_pa(m.outlet_max_barg),
        max_ratio=m.max_ratio,
        stages=m.stages,
        efficiency=m.efficiency,
        intercooled=m.intercooled,
        flow=m.flow_nm3_h * rho_normal / 3600,
    )


def to_exchanger(hx: HeatExchangerIn) -> Exchanger | None:
    if not hx.installed:
        return None
    fixed = c_to_k(hx.outlet_temp_c) if hx.control == "outlet_temp" else None
    return Exchanger(fixed, c_to_k(hx.coolant_temp_c), hx.effectiveness_pct / 100)


def copv_area(volume_m3: float) -> float:
    """Outer surface of a cylinder with hemispherical ends and length = 3 diameters holding `volume_m3`."""
    # V = pi D^2/4 * 2D + pi D^3/6 (cylinder part 2D long + two hemispheres)
    D = (volume_m3 / (math.pi / 2 + math.pi / 6)) ** (1 / 3)
    return math.pi * D * 2 * D + math.pi * D**2


class Scenario:
    """Static fill context plus the initial state of every vessel."""

    def __init__(self, settings: Settings, copv: CopvIn, sources: list[SourceIn], increments: int = 120,
                 equipment: EquipmentIn | None = None, heat_exchanger: HeatExchangerIn | None = None,
                 after_test: AfterTestIn | None = None, time_model: TimeModelIn | None = None):
        self.copv_in = copv
        self.sources_in = {s.id: s for s in sources}
        if len(self.sources_in) != len(sources):
            raise ValueError("Source ids must be unique")
        self.usable = [s.id for s in sources if s.fluid == copv.fluid]
        self.equipment = equipment or EquipmentIn()
        self.after_test = after_test or AfterTestIn()
        self.time_model = time_model if time_model and time_model.enabled else None
        self.warnings: list[str] = []
        self._group_label = "manifold"

        f = get_fluid(copv.fluid)
        T0 = c_to_k(settings.ambient_temp_c)
        self.parallel = n = copv.parallel  # identical COPVs filled together, gas split equally
        Vc = n * copv.volume_l / 1000
        self.rho_normal = f.rho_PT(P_ATM, T_NORMAL)
        self.machines = {k: to_machine(getattr(self.equipment, k), self.rho_normal) for k in ("booster", "compressor")}
        one_area = self.time_model.copv_area_m2 if self.time_model and self.time_model.copv_area_m2 else copv_area(Vc / n)
        self.area = n * one_area
        volumes = {s.id: s.volume_m3 for s in sources}
        wall_C = n * copv.wall_mass_kg * copv.wall_cp_j_kgk if settings.mode == "adiabatic_wall" else 0.0
        x = copv.leak_pct / 100  # the COPV costs (1 + x) of its gas
        timing = None
        if self.time_model:
            d = self.time_model.orifice_mm / 1000
            timing = Timing(DISCHARGE_COEFFICIENT * math.pi * d * d / 4, self.time_model.max_rate_bar_min * 1e5 / 60)
        self.ctx = FillContext(
            fluid=f,
            mode=settings.mode,
            T0=T0,
            copv_volume=Vc,
            m_target=f.rho_PT(barg_to_pa(copv.target_barg), T0) * Vc,
            wall_C=wall_C,
            source_volumes={sid: volumes[sid] for sid in self.usable},
            increments=increments,
            leak=x / (1 + x),
            exchanger=to_exchanger(heat_exchanger) if heat_exchanger else None,
            timing=timing,
            source_max={s.id: barg_to_pa(s.rated_barg) for s in sources if s.id in self.usable and s.rated_barg},
        )
        # Source pressures are quoted at 20 °C; the gas starts at ambient temperature.
        self.initial = FillState(
            copv=Vessel(f.rho_PT(barg_to_pa(copv.initial_barg), T0) * Vc, T0),
            sources={
                sid: Vessel(f.rho_PT(barg_to_pa(self.sources_in[sid].pressure_barg), T_SOURCE_REF) * volumes[sid], T0)
                for sid in self.usable
            },
        )
        if self.after_test.action == "recover" and self.after_test.vessel_id not in self.usable:
            self.warnings.append(f"Gas recovery is on but no {copv.fluid} recovery bundle is selected; skipped.")

    def view(self, v: Vessel, volume: float) -> VesselView:
        return VesselView(pressure_barg=pa_to_barg(pressure(self.ctx, v, volume)), temp_c=k_to_c(v.T), mass_kg=v.m)

    def label(self, sid: str | None) -> str:
        if sid == GROUP:
            return self._group_label
        src = self.sources_in.get(sid or "")
        if src is None:
            return "?"
        return f"{src.label or sid} ×{src.quantity}" if src.quantity > 1 else (src.label or sid)

    def cool_params(self, cop: Vessel) -> tuple[float, float]:
        """(temperature once gas and wall share their heat [K], time constant of the outside cooling [s]).

        The wall heat capacity is always included: the hot gas quickly heats the wall, then both cool together.
        """
        tm, ctx = self.time_model, self.ctx
        st = ctx.fluid.at_DT(cop.m / ctx.copv_volume, cop.T)
        C_gas = cop.m * (st.cv if math.isfinite(st.cv) else 1000.0)
        C_wall = self.parallel * self.copv_in.wall_mass_kg * self.copv_in.wall_cp_j_kgk
        T_wall = cop.T if ctx.mode == "adiabatic_wall" else ctx.T0
        T_start = (C_gas * cop.T + C_wall * T_wall) / (C_gas + C_wall)
        h = tm.h_ext_w_m2k if tm else 10.0
        return T_start, (C_gas + C_wall) / (h * self.area)

    def cool_time(self, cop: Vessel) -> float:
        """Seconds for the COPV to get back within the tolerance of ambient (lumped gas + wall, outside convection)."""
        tm, ctx = self.time_model, self.ctx
        if tm is None or ctx.mode == "isothermal":
            return 0.0
        T_start, tau = self.cool_params(cop)
        dT = abs(T_start - ctx.T0)
        if dT <= tm.settle_tolerance_k:
            return 0.0
        return tau * math.log(dT / tm.settle_tolerance_k)

    def run(self, sequence: list[SequenceItem]) -> SimulateResponse:
        ctx, Vc = self.ctx, self.ctx.copv_volume
        state = self.initial
        steps: list[StepOut] = []
        fill_records: list[StepRecord] = []
        cop0 = state.copv
        trace = [self._trace_point(0, 0.0, pressure(ctx, cop0, Vc), cop0.T, cop0.m, None)]
        delivered = 0.0
        warnings = list(self.warnings)
        tl = _Timeline(self, state)

        for i, item in enumerate(sequence, start=1):
            step_out = None
            sid, target = item.source_id, item.target_id
            if item.type == "cooldown":
                new, rec = cooldown(ctx, state, with_trace=True)
                if self.time_model:
                    rec.duration = self.cool_time(state.copv)
                tl.cool(f"{i}. Cool-down", state, new, rec.duration)
            else:
                if item.feeds_pump and item.type in ("source", "pump"):
                    steps.append(self._skipped(i, item, "feeds_pump", self._feed_message(i, item, sequence), state))
                    continue
                problem = self._check_step(i, item)
                if problem:
                    status, msg = problem
                    steps.append(self._skipped(i, item, status, msg, state))
                    warnings.append(f"Step {i}: {msg}")
                    tl.idle(f"{i}. Skipped", state)
                    continue
                machine = self._train(item) if item.type == "pump" else None
                members = self._members(item)
                if len(members) > 1:  # bundles on a manifold act as one vessel
                    step_ctx, before, mixing = self._grouped(state, members)
                    giver = GROUP
                else:
                    step_ctx, before, mixing, giver = ctx, state, 0.0, sid
                if target is not None:
                    stop = barg_to_pa(item.stop_barg) if item.stop_barg else None
                    after, rec = fill_vessel(step_ctx, before, giver, target, machine, stop, item.type, with_trace=True)
                elif machine is None:
                    after, rec = connect(step_ctx, before, giver, with_trace=True)
                else:
                    after, rec = pump(step_ctx, before, giver, machine, with_trace=True)
                if len(members) > 1:
                    step_out = self._step_out(i, item.type, item.machine, rec, before, after, step_ctx, item.feed_machines)
                    step_out.source_id, step_out.source_ids = members[0], list(members)
                    rec.members, rec.exergy_destroyed = tuple(members), rec.exergy_destroyed + mixing
                    new = self._ungrouped(after, members)
                else:
                    step_out, new = None, after
                tl.transfer(f"{i}. {self._step_label(item)}", rec, state, new, giver=list(members),
                            taker=target if target is not None else "copv")

            # The COPV-centred trace for the "gas delivered" plots; bundle fills leave the COPV alone.
            if item.type == "cooldown":
                for d, _, _, Pc, Tc, _ in rec.trace:
                    trace.append(self._trace_point(i, delivered, Pc, Tc, state.copv.m, None))
            elif target is None:
                for d, Pg, _, Pc, Tc, _ in rec.trace:
                    trace.append(self._trace_point(i, delivered + d, Pc, Tc, state.copv.m + d, Pg))
            steps.append(step_out or self._step_out(i, item.type, item.machine, rec, state, new, feed=item.feed_machines))
            fill_records.append(rec)
            delivered += rec.dm if target is None else 0.0
            state = new

        test_state = state  # end of fill
        # The test reading is the settled pressure, so venting or recovery starts from the cooled-down state.
        settled_test, settle = cooldown(ctx, test_state)
        tl.cool("Settling", test_state, settled_test, self.cool_time(test_state.copv) if self.time_model else None)
        if self.time_model and self.time_model.hold_min > 0:
            tl.idle("Test hold", settled_test, self.time_model.hold_min * 60)
        state = settled_test
        after: list[StepRecord] = []
        action = self.after_test.action
        if action == "recover" and self.after_test.vessel_id in self.usable:
            vid, hooked = self.after_test.vessel_id, False
            for machine_kind in (None, "compressor"):
                machine = self.machines["compressor"] if machine_kind else None
                new, rec = recover(ctx, state, vid, machine, with_trace=True)
                steps.append(self._step_out(len(steps) + 1, "recovery", machine_kind, rec, state, new))
                tl.transfer("Recovery " + ("compressor" if machine_kind else "valve"), rec, state, new, giver="copv",
                            taker=vid, hookup=not hooked)
                hooked = hooked or rec.dm > 0
                after.append(rec)
                state = new
        elif action == "vent":
            new, rec = vent(ctx, state, barg_to_pa(self.after_test.vent_to_barg), with_trace=True)
            steps.append(self._step_out(len(steps) + 1, "vent", None, rec, state, new))
            tl.transfer("Vent", rec, state, new, giver="copv", taker=None)
            after.append(rec)
            state = new

        _, final_cool = cooldown(ctx, state)
        tail_exergy = settle.exergy_destroyed + final_cool.exergy_destroyed
        return SimulateResponse(
            steps=steps,
            trace=trace,
            timeline=tl.points,
            summary=self._summary(test_state, settled_test, state, fill_records, after, tail_exergy, trace, steps),
            sources=self._source_results(test_state, state, fill_records),
            warnings=warnings,
        )

    def _check_step(self, i: int, item: SequenceItem) -> tuple[str, str] | None:
        """Why a source/pump step cannot run, or None."""
        sid, target = item.source_id, item.target_id
        members = self._members(item)
        if not members:
            return "no_flow", "No feed source selected; skipped."
        for ref in (*members, target):
            if ref is not None and ref not in self.sources_in:
                raise ValueError(f"Sequence step {i} refers to unknown source {ref!r}")
        if target is not None and target in members:
            return "no_flow", "A bundle on the manifold cannot also be the one being filled; skipped."
        for ref in (*members, target):
            if ref is not None and ref not in self.ctx.source_volumes:
                src = self.sources_in[ref]
                return "fluid_mismatch", f"{src.label or ref} holds {src.fluid} but the COPV is filled with {self.copv_in.fluid}; skipped."
        if target == sid:
            return "no_flow", "A bundle cannot fill itself; skipped."
        return None

    def _feed_message(self, i: int, item: SequenceItem, sequence: list[SequenceItem]) -> str:
        pumps = [k for k, it in enumerate(sequence, start=1)
                 if it.type == "pump" and k != i and it.source_id == item.source_id and not it.feeds_pump]
        k = min(pumps, key=lambda k: abs(k - i)) if pumps else None
        name = MACHINE_NAMES[sequence[k - 1].machine or "booster"] if k else "pump"
        where = f" (step {k})" if k else ""
        if item.type == "pump":
            return f"The {MACHINE_NAMES[item.machine or 'booster']} discharges into the {name}{where}; they run in series."
        return f"{self.label(item.source_id)} is connected to the {name}{where}, which moves its gas."

    def _train(self, item: SequenceItem) -> Machine:
        """The step's machine, fed by any machines in series upstream of it."""
        machine = None
        for kind in [*(item.feed_machines or []), item.machine or "booster"]:
            machine = replace(self.machines[kind], feed=machine)
        return machine

    @staticmethod
    def _train_name(machine: MachineKind | None, feed: list[MachineKind] | None) -> str:
        return " → ".join(MACHINE_NAMES[k] for k in [*(feed or []), machine or "booster"])

    def _members(self, item: SequenceItem) -> list[str]:
        """The bundles a step draws from: several when they are opened together on a manifold."""
        ids = [s for s in (item.source_ids or []) if s]
        if not ids and item.source_id:
            ids = [item.source_id]
        return list(dict.fromkeys(ids))

    def _grouped(self, state: FillState, members: list[str]) -> tuple[FillContext, FillState, float]:
        """Bundles opened together on a manifold become one vessel: combined volume, gas mixed to one state.

        Returns the context and state with that vessel in place of the members, and the exergy destroyed by
        the mixing (higher-pressure bundles back-filling lower ones through the header).
        """
        ctx, f = self.ctx, self.ctx.fluid
        vols = [ctx.source_volumes[m] for m in members]
        vessels = [state.sources[m] for m in members]
        V, mass = sum(vols), sum(v.m for v in vessels)
        if ctx.mode == "isothermal":
            T = ctx.T0
        else:
            U = sum(v.m * f.at_DT(v.m / Vm, v.T).u for v, Vm in zip(vessels, vols))
            T = f.at_DE(mass / V, mass, U, 0.0, ctx.T0, sum(v.m * v.T for v in vessels) / mass).T
        group = Vessel(mass, T)
        sources = {k: v for k, v in state.sources.items() if k not in members}
        sources[GROUP] = group
        volumes = {k: v for k, v in ctx.source_volumes.items() if k not in members}
        volumes[GROUP] = V
        gctx = replace(ctx, source_volumes=volumes)
        mixing = sum(exergy(ctx, v, Vm) for v, Vm in zip(vessels, vols)) - exergy(gctx, group, V)
        self._group_label = " + ".join(self.label(m) for m in members)
        return gctx, FillState(state.copv, sources), max(mixing, 0.0)

    def _ungrouped(self, state: FillState, members: list[str]) -> FillState:
        """Split the combined vessel back: every member ends at the same density and temperature."""
        group = state.sources[GROUP]
        vols = {m: self.ctx.source_volumes[m] for m in members}
        rho = group.m / sum(vols.values())
        sources = {k: v for k, v in state.sources.items() if k != GROUP}
        sources.update({m: Vessel(rho * Vm, group.T) for m, Vm in vols.items()})
        return FillState(state.copv, sources)

    def _step_label(self, item: SequenceItem) -> str:
        into = self.label(item.target_id) if item.target_id else "COPV"
        via = f"{self._train_name(item.machine, item.feed_machines).capitalize()}: " if item.type == "pump" else ""
        members = self._members(item)
        source = "Manifold (" + " + ".join(self.label(m) for m in members) + ")" if len(members) > 1 else self.label(item.source_id)
        return f"{via}{source} → {into}"

    # ------------------------------------------------------------ reporting

    def _trace_point(self, step: int, delivered: float, Pc: float, Tc: float, mc: float, Ps: float | None):
        return TracePointOut(
            step=step,
            delivered_kg=delivered,
            copv_barg=pa_to_barg(Pc),
            copv_temp_c=k_to_c(Tc),
            copv_settled_barg=pa_to_barg(settled_pressure(self.ctx, mc, self.ctx.copv_volume)),
            source_barg=None if Ps is None else pa_to_barg(Ps),
        )

    def _skipped(self, i: int, item: SequenceItem, status, msg: str, state: FillState) -> StepOut:
        cop = self.view(state.copv, self.ctx.copv_volume)
        return StepOut(index=i, type=item.type, source_id=item.source_id, machine=item.machine, status=status,
                       message=msg, delivered_kg=0, settled_gain_bar=0, wasted_exergy_kj=0,
                       copv_before=cop, copv_after=cop)

    def _step_out(self, i: int, kind, machine: MachineKind | None, rec: StepRecord,
                  before: FillState, after: FillState, ctx: FillContext | None = None,
                  feed: list[MachineKind] | None = None) -> StepOut:
        ctx = ctx or self.ctx
        Vc = ctx.copv_volume
        cb, ca = self.view(before.copv, Vc), self.view(after.copv, Vc)
        sb = sa = tb = ta = None
        if rec.source_id is not None:
            Vs = ctx.source_volumes[rec.source_id]
            sb = self.view(before.sources[rec.source_id], Vs)
            sa = self.view(after.sources[rec.source_id], Vs)
        target = rec.target_id if kind in ("source", "pump") else None
        if target is not None:
            Vt = ctx.source_volumes[target]
            tb, ta = self.view(before.sources[target], Vt), self.view(after.sources[target], Vt)
        return StepOut(
            index=i, type=kind, source_id=rec.source_id, machine=machine, feed_machines=feed or None, status=rec.status,
            message=self._message(kind, machine, rec, cb, ca, sb, sa, tb, ta, feed),
            target_id=target, target_before=tb, target_after=ta,
            delivered_kg=rec.dm, leaked_kg=rec.leaked, settled_gain_bar=rec.settled_gain / 1e5,
            wasted_exergy_kj=rec.exergy_destroyed / 1e3, energy_kwh=rec.work / 3.6e6,
            outlet_temp_max_c=None if rec.outlet_T_max is None else k_to_c(rec.outlet_T_max),
            hx_duty_kwh=rec.hx_duty / 3.6e6,
            hx_outlet_min_c=k_to_c(rec.hx_T[0]) if rec.hx_T else None,
            hx_outlet_max_c=k_to_c(rec.hx_T[1]) if rec.hx_T else None,
            duration_min=None if rec.duration is None else rec.duration / 60,
            copv_before=cb, copv_after=ca, source_before=sb, source_after=sa,
        )

    def _message(self, kind, machine: MachineKind | None, rec: StepRecord, cb: VesselView, ca: VesselView,
                 sb: VesselView | None, sa: VesselView | None, tb: VesselView | None = None,
                 ta: VesselView | None = None, feed: list[MachineKind] | None = None) -> str:
        name = MACHINE_NAMES[machine] if machine else ""
        spec = getattr(self.equipment, machine) if machine else None
        first = (feed or [machine])[0]  # the machine drawing from the source
        recovering = kind == "recovery"
        giver, taker = ("the COPV", self.label(rec.source_id)) if recovering else (self.label(rec.source_id), "the COPV")
        if tb is not None:  # bundle fill: the target plays the COPV's part
            taker, cb, ca = self.label(rec.target_id), tb, ta
        status = rec.status if rec.status != "no_flow" else rec.blocked_by
        prefix = "Not started: " if rec.status == "no_flow" else ""
        match status:
            case "target_reached" if rec.status == "no_flow":
                msg = "Target already reached; not connected."
            case "target_reached":
                msg = f"COPV holds its target gas content; stopped after {rec.dm:.2f} kg."
            case "equalized" if rec.status == "no_flow":
                gp, tp = (cb, sb) if recovering else (sb, cb)
                msg = f"{giver} at {gp.pressure_barg:.1f} barg is not above {taker} ({tp.pressure_barg:.1f} barg); valve not opened."
            case "equalized":
                msg = f"Pressures equalized at {(sa if recovering else ca).pressure_barg:.1f} barg after {rec.dm:.2f} kg."
            case "inlet_limit" if feed and sa is not None and sa.pressure_barg > getattr(self.equipment, first).inlet_min_barg + 0.5:
                msg = f"{prefix}The {MACHINE_NAMES[first]} cannot lift the gas to the {name} minimum inlet ({spec.inlet_min_barg:g} barg)."
            case "inlet_limit":
                msg = f"{prefix}{giver} down to the {MACHINE_NAMES[first]} minimum inlet ({getattr(self.equipment, first).inlet_min_barg:g} barg)."
            case "outlet_limit":
                msg = f"{prefix}{taker} at the {name} maximum outlet ({spec.outlet_max_barg:g} barg)."
            case "ratio_limit":
                msg = f"{prefix}{name.capitalize()} pressure-ratio limit ({spec.max_ratio:g}:1) reached."
            case "filled" if rec.status == "no_flow":
                msg = f"{taker} is already at its stop pressure ({cb.pressure_barg:.1f} barg); not connected."
            case "filled":
                msg = f"{taker} filled to {ca.pressure_barg:.1f} barg with {rec.dm:.2f} kg."
            case "vented" if rec.status == "no_flow":
                msg = "COPV already at or below the vent pressure."
            case "vented":
                msg = (f"Vented {rec.dm:.2f} kg to atmosphere; COPV {cb.pressure_barg:.1f} -> {ca.pressure_barg:.1f} barg, "
                       f"gas at {ca.temp_c:.0f} °C.")
            case "not_needed":
                msg = "Target already reached; not connected."
            case _:
                msg = (f"Everything back to {k_to_c(self.ctx.T0):.1f} °C; COPV "
                       f"{cb.pressure_barg:.1f} -> {ca.pressure_barg:.1f} barg.")
        if rec.leaked > 0:
            msg += f" {rec.leaked:.2f} kg leaked on the way."
        return msg

    def _summary(self, end: FillState, settled: FillState, final: FillState, records: list[StepRecord],
                 after: list[StepRecord], tail_exergy: float, trace: list[TracePointOut],
                 steps: list[StepOut]) -> Summary:
        ctx, Vc = self.ctx, self.ctx.copv_volume
        settled_view = self.view(settled.copv, Vc)
        reached = end.copv.m >= ctx.m_target * (1 - 1e-6)
        target = self.copv_in.target_barg
        opened = [r for r in records if r.kind in ("source", "pump") and r.dm > 0]
        opened_ids = {m for r in opened for m in (r.members or (r.source_id,))}
        pumped = [r for r in records if r.kind == "pump"]
        recovery = [r for r in after if r.kind == "recovery"]
        vented = [r for r in after if r.kind == "vent"]
        minutes = lambda kinds: sum(s.duration_min or 0 for s in steps if s.type in kinds)  # noqa: E731

        time = None
        if self.time_model:
            tm = self.time_model
            connections = len(opened) + (1 if any(r.dm > 0 for r in after) else 0)
            handling = connections * tm.connection_min
            fill = minutes(("source", "pump", "cooldown"))
            settle = self.cool_time(end.copv) / 60
            after_min = minutes(("recovery", "vent"))
            time = TimeBreakdown(handling_min=handling, fill_min=fill, settle_min=settle, hold_min=tm.hold_min,
                                 after_test_min=after_min, total_min=handling + fill + settle + tm.hold_min + after_min,
                                 copv_area_m2=self.area)

        return Summary(
            target_barg=target,
            target_reached=reached,
            shortfall_bar=0.0 if reached else max(target - settled_view.pressure_barg, 0.0),
            copv_end=self.view(end.copv, Vc),
            copv_settled=settled_view,
            peak_gas_temp_c=max(p.copv_temp_c for p in trace),
            peak_pressure_barg=max(p.copv_barg for p in trace),
            delivered_kg=end.copv.m - self.initial.copv.m,
            wasted_exergy_kj=(sum(r.exergy_destroyed for r in records + after) + tail_exergy) / 1e3,
            sources_opened=len(opened_ids),
            connections=len(opened),
            cooldowns=sum(1 for r in records if r.kind == "cooldown"),
            leaked_kg=sum(r.leaked for r in records),
            pump_energy_kwh=sum(r.work for r in pumped) / 3.6e6,
            pump_time_min=minutes(("pump",)),
            recovered_kg=sum(r.dm for r in recovery),
            recovery_energy_kwh=sum(r.work for r in recovery) / 3.6e6,
            recovery_time_min=minutes(("recovery",)),
            vented_kg=sum(r.dm for r in vented),
            copv_after_test=self.view(final.copv, Vc) if after else None,
            hx_duty_kwh=sum(r.hx_duty for r in records) / 3.6e6,
            hx_chiller_kwh=sum(r.hx_work for r in records) / 3.6e6,
            time=time,
            parallel=self.parallel,
        )

    def _source_results(self, fill_end: FillState, final: FillState, records: list[StepRecord]) -> list[SourceResult]:
        """`end` is each source at the end of the fill; settled/carry-over values use the final masses (after recovery)."""
        ctx = self.ctx
        results = []
        for sid, src in self.sources_in.items():
            connections = sum(1 for r in records if (r.source_id == sid or sid in r.members) and r.dm > 0)
            if sid in ctx.source_volumes:
                Vs = ctx.source_volumes[sid]
                v0, v1 = self.initial.sources[sid], final.sources[sid]
                start, finish = self.view(v0, Vs), self.view(fill_end.sources[sid], Vs)
                settled = pa_to_barg(ctx.fluid.P_DT(v1.m / Vs, ctx.T0))
                ref = pa_to_barg(ctx.fluid.P_DT(v1.m / Vs, T_SOURCE_REF))
                used = v0.m - v1.m
            else:  # other gas: untouched
                f = get_fluid(src.fluid)
                Vs = src.volume_m3
                m = f.rho_PT(barg_to_pa(src.pressure_barg), T_SOURCE_REF) * Vs
                start = finish = VesselView(pressure_barg=pa_to_barg(f.P_DT(m / Vs, ctx.T0)), temp_c=k_to_c(ctx.T0), mass_kg=m)
                settled, ref, used = start.pressure_barg, src.pressure_barg, 0.0
            results.append(SourceResult(id=sid, start=start, end=finish, settled_barg=settled,
                                        pressure_ref_barg=ref, used_kg=used, connections=connections))
        return results


class _Timeline:
    """Every vessel's pressure and the COPV gas temperature along the cycle, for the over-the-sequence plots."""

    def __init__(self, sc: Scenario, state: FillState):
        self.sc = sc
        self.timed = sc.time_model is not None
        self.t = 0.0  # s
        self.p = 0.0  # progress: step k spans [k-1, k]
        self.points: list[TimelinePoint] = []
        self._emit_state("Start", state)

    def _source_pressures(self, state: FillState) -> dict[str, float]:
        ctx = self.sc.ctx
        return {sid: pressure(ctx, v, ctx.source_volumes[sid]) for sid, v in state.sources.items()}

    def _emit(self, phase: str, copv_P: float, copv_T: float, vessels: dict[str, float], t: float, p: float):
        self.points.append(TimelinePoint(
            t_min=t / 60 if self.timed else None, progress=p, phase=phase, copv_barg=pa_to_barg(copv_P),
            copv_temp_c=k_to_c(copv_T), vessels={sid: pa_to_barg(P) for sid, P in vessels.items()},
        ))

    def _emit_state(self, phase: str, state: FillState):
        ctx = self.sc.ctx
        self._emit(phase, pressure(ctx, state.copv, ctx.copv_volume), state.copv.T, self._source_pressures(state),
                   self.t, self.p)

    def idle(self, phase: str, state: FillState, seconds: float | None = None):
        """A step where nothing moves: flat for `seconds` (time axis) or one step (step axis)."""
        self._emit_state(phase, state)
        if self.timed and seconds:
            self.t += seconds
        self.p += 1
        self._emit_state(phase, state)

    def transfer(self, phase: str, rec: StepRecord, before: FillState, after: FillState, *, giver: str | list[str],
                 taker: str | None, hookup: bool = True):
        if rec.dm <= 0 or not rec.trace:
            self.idle(phase, before)
            return
        ctx, tm = self.sc.ctx, self.sc.time_model
        if self.timed and hookup and tm.connection_min > 0:
            self.idle("Hook-up", before, tm.connection_min * 60)
            self.p -= 1  # hook-up takes time but is part of this step
        base = self._source_pressures(before)
        copv_P, copv_T = pressure(ctx, before.copv, ctx.copv_volume), before.copv.T
        total, duration = rec.trace[-1][0], rec.duration or 0.0
        for x, Pg, Tg, Pt, Tt, te in rec.trace:
            vessels, cP, cT = dict(base), copv_P, copv_T
            if giver == "copv":
                cP, cT = Pg, Tg
            else:
                for g in [giver] if isinstance(giver, str) else giver:
                    vessels[g] = Pg
            if taker == "copv":
                cP, cT = Pt, Tt
            elif taker is not None:
                vessels[taker] = Pt
            frac = te / duration if self.timed and duration > 0 and te is not None else (x / total if total > 0 else 1.0)
            self._emit(phase, cP, cT, vessels, self.t + (te or 0.0 if self.timed else 0.0), self.p + frac)
        if self.timed:
            self.t += duration
        self.p += 1

    def cool(self, phase: str, before: FillState, after: FillState, duration: float | None):
        """Exponential cooling of the COPV (and sources) back to ambient."""
        ctx = self.sc.ctx
        if all(v.T == ctx.T0 for v in [before.copv, *before.sources.values()]):
            if phase != "Settling":
                self.idle(phase, before)
            return
        if not (self.timed and duration):
            self._emit_state(phase, before)
            self.p += 1
            self._emit_state(phase, after)
            return
        T0 = ctx.T0
        T_mix, tau = self.sc.cool_params(before.copv)
        self._emit_state(phase, before)
        n = 16
        for k in range(n + 1):
            dt = duration * k / n
            decay = math.exp(-dt / tau)
            cT = T0 + (T_mix - T0) * decay if k < n else T0
            cP = ctx.fluid.P_DT(before.copv.m / ctx.copv_volume, cT)
            vessels = {}
            for sid, v in before.sources.items():
                Ts = T0 + (v.T - T0) * decay if k < n else T0
                vessels[sid] = ctx.fluid.P_DT(v.m / ctx.source_volumes[sid], Ts)
            self._emit(phase, cP, cT, vessels, self.t + dt, self.p + k / n)
        self.t += duration
        self.p += 1


def simulate(req: SimulateRequest) -> SimulateResponse:
    return Scenario(req.settings, req.copv, req.sources, equipment=req.equipment, heat_exchanger=req.heat_exchanger,
                    after_test=req.after_test, time_model=req.time_model).run(req.sequence)
