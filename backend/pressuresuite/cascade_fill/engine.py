"""Cascade-fill physics.

Each vessel is rigid and holds a single gas, so its state is fixed by the gas
mass and temperature. A *transfer* moves gas from a giver to a taker vessel:

- connection: a valve between a source and the COPV, until the pressures
  equalize or the COPV holds its target mass.
- pump: a boost pump or compressor between a source and the COPV, until the
  source drops to the machine's minimum inlet pressure, the COPV reaches the
  maximum outlet pressure, the pressure-ratio limit, or its target mass.
- recovery: after the test, gas goes from the COPV back into a bundle, first
  through a valve (equalization), then through the compressor.
- vent: after the test, the COPV blows down to atmosphere to a set pressure.
- bundle fill: a valve or machine moves gas from one source into another
  source (e.g. boosting an intermediate bundle) until a stop pressure, capped
  at the receiving bundle's rated pressure.

A *cool-down* waits until every vessel is back at ambient temperature.

Thermal models
- isothermal: every vessel stays at ambient temperature (slow fill).
- adiabatic: the gas left in the giver expands isentropically, valves are
  isenthalpic (Joule-Thomson effects included), and the taker receives no
  heat:  d(m*u)_taker = h_in * dm.
- adiabatic_wall: as adiabatic, but the COPV wall (liner + overwrap) stays at
  the gas temperature:  d(m*u + C_wall*T)_copv = h_in * dm.
  Strain (thermo-elastic) heating of the composite is neglected.

Machines compress in equal-ratio stages with an isentropic efficiency and,
optionally, intercooling to ambient between stages; there is no aftercooler,
so the gas leaves at the last stage's discharge temperature. A feed above the
maximum inlet pressure is throttled by an inlet regulator. Machines can run in
series (a compressor feeding a boost pump): the pressure between them splits
the overall ratio equally over all stages, within each machine's limits, with
no cooler in between; the slowest machine sets the flow.

A heat exchanger in the fill line sets the temperature of the gas entering the
COPV (fixed outlet temperature, or effectiveness against a coolant). It does
nothing in the isothermal model, where the COPV stays at ambient anyway.

Fill losses: a fraction `leak` of the gas leaving a source during a fill
escapes (fittings, hoses), so the COPV receives (1 - leak) of it.

The COPV target is a *settled* pressure: the fill stops once the COPV holds the
mass that gives the target pressure at ambient temperature.

Waste is measured as destroyed exergy: the drop of the vessels' exergy
(relative to gas at ambient temperature and pressure) plus machine work and
the minimum (Carnot) work a chiller needs for the heat exchanger. Leaked and
vented gas counts as destroyed.

Timing (optional) does not change any state: valve transfers integrate the
flow through an orifice (choked or subsonic) along the path, machines use
their rated flow, and an optional pressurization-rate limit slows both.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from ..config import P_ATM
from ..thermo import Fluid, GasState

Mode = Literal["isothermal", "adiabatic", "adiabatic_wall"]
Status = Literal[
    "target_reached", "equalized", "inlet_limit", "outlet_limit", "ratio_limit", "vented", "filled",
    "no_flow", "not_needed", "cooled",
]
Kind = Literal["source", "cooldown", "pump", "recovery", "vent"]

# (kg received by the taker so far, giver P [Pa], giver T [K], taker P [Pa], taker T [K], seconds or None).
# The taker fields are None when venting to atmosphere.
TracePoint = tuple[float, float, float, float | None, float | None, float | None]
CopvSide = Literal["giver", "taker"] | None


@dataclass(frozen=True, slots=True)
class Vessel:
    m: float  # kg of gas
    T: float  # K, gas temperature (the COPV wall shares it in adiabatic_wall mode)


@dataclass(frozen=True, slots=True)
class Machine:
    """Boost pump or compressor; pressures are absolute, Pa."""

    inlet_min: float
    inlet_max: float
    outlet_max: float
    max_ratio: float
    stages: int
    efficiency: float
    intercooled: bool
    flow: float = 0.0  # kg/s at rated throughput (0: unknown)
    feed: Machine | None = None  # machine in series upstream, discharging into this one's inlet

    @property
    def train(self) -> tuple[Machine, ...]:
        """Every machine the gas passes through, upstream first."""
        return (*self.feed.train, self) if self.feed is not None else (self,)

    @property
    def throughput(self) -> float:
        """kg/s through the train: the slowest machine with a known flow sets it (0: unknown)."""
        flows = [m.flow for m in self.train if m.flow > 0]
        return min(flows) if flows else 0.0


@dataclass(frozen=True, slots=True)
class Exchanger:
    """Fill-line heat exchanger: a fixed outlet temperature, or effectiveness against a coolant (K)."""

    outlet_T: float | None
    coolant_T: float
    effectiveness: float

    def exit_T(self, T_in: float) -> float:
        if self.outlet_T is not None:
            return self.outlet_T
        return T_in - self.effectiveness * (T_in - self.coolant_T)

    def sink_T(self, T_out: float) -> float:
        """Temperature the heat is exchanged with (for the chiller-work estimate)."""
        return T_out if self.outlet_T is not None else self.coolant_T


@dataclass(frozen=True, slots=True)
class Timing:
    cd_area: float  # m2, discharge coefficient x valve flow area
    rate_limit: float  # Pa/s, max rate of change of COPV pressure (0: none)


@dataclass(frozen=True)
class FillContext:
    fluid: Fluid
    mode: Mode
    T0: float  # ambient temperature, K
    copv_volume: float  # m3
    m_target: float  # COPV gas mass at the settled target pressure, kg
    wall_C: float  # COPV wall heat capacity, J/K (0 unless adiabatic_wall)
    source_volumes: dict[str, float]  # m3
    increments: int = 120  # mass increments per marched transfer
    leak: float = 0.0  # fraction of the gas leaving a source during a fill that escapes
    exchanger: Exchanger | None = None  # in the fill line
    timing: Timing | None = None
    source_max: dict[str, float] = field(default_factory=dict)  # Pa, rated pressure caps when filling a source
    dead: tuple[float, float, float] = field(init=False)  # u0, s0, v0 at ambient T and P

    def __post_init__(self):
        st = self.fluid.at_DT(self.fluid.rho_PT(P_ATM, self.T0), self.T0)
        object.__setattr__(self, "dead", (st.u, st.s, 1 / st.rho))


@dataclass(frozen=True)
class FillState:
    copv: Vessel
    sources: dict[str, Vessel]

    def with_vessels(self, copv: Vessel, sid: str, src: Vessel) -> FillState:
        sources = dict(self.sources)
        sources[sid] = src
        return FillState(copv, sources)


@dataclass
class StepRecord:
    kind: Kind
    source_id: str | None
    status: Status
    dm: float = 0.0  # kg received (by the COPV; by the bundle when recovering; vented to air when venting)
    leaked: float = 0.0  # kg lost on the way
    exergy_destroyed: float = 0.0  # J
    settled_gain: float = 0.0  # Pa, change of the COPV's settled pressure
    work: float = 0.0  # J of machine work
    outlet_T_max: float | None = None  # K, hottest machine discharge
    blocked_by: Status | None = None  # why a transfer could not start
    duration: float | None = None  # s, when timing is on (always for machines with a rated flow)
    hx_duty: float = 0.0  # J removed from the gas by the heat exchanger
    hx_T: tuple[float, float] | None = None  # K, coldest and hottest heat-exchanger outlet
    trace: list[TracePoint] = field(default_factory=list)
    hx_work: float = 0.0  # J, minimum chiller work for the heat exchanger
    target_id: str | None = None  # receiving source for bundle fills and recovery (None: the COPV)
    members: tuple[str, ...] = ()  # bundles opened together on a manifold (the giver was their combination)


def pressure(ctx: FillContext, v: Vessel, volume: float) -> float:
    return ctx.fluid.P_DT(v.m / volume, v.T)


def settled_pressure(ctx: FillContext, m: float, volume: float) -> float:
    return ctx.fluid.P_DT(m / volume, ctx.T0)


def exergy(ctx: FillContext, v: Vessel, volume: float, wall_C: float = 0.0) -> float:
    """Exergy of a vessel's gas (and wall) relative to the gas at ambient T and P, J."""
    st = ctx.fluid.at_DT(v.m / volume, v.T)
    u0, s0, v0 = ctx.dead
    phi = v.m * ((st.u - u0) - ctx.T0 * (st.s - s0) + P_ATM * (1 / st.rho - v0))
    if wall_C:
        phi += wall_C * ((v.T - ctx.T0) - ctx.T0 * math.log(v.T / ctx.T0))
    return phi


def orifice_flow(cd_area: float, P_up: float, rho_up: float, gamma: float, P_down: float) -> float:
    """Compressible flow through an orifice, kg/s (choked or subsonic)."""
    if P_up <= P_down:
        return 0.0
    g = gamma if math.isfinite(gamma) and gamma > 1 else 1.4
    r = P_down / P_up
    if r <= (2 / (g + 1)) ** (g / (g - 1)):
        return cd_area * math.sqrt(g * rho_up * P_up * (2 / (g + 1)) ** ((g + 1) / (g - 1)))
    return cd_area * math.sqrt(2 * rho_up * P_up * g / (g - 1) * (r ** (2 / g) - r ** ((g + 1) / g)))


# ---------------------------------------------------------------- public steps

def connect(ctx: FillContext, state: FillState, sid: str, *, with_trace: bool = False) -> tuple[FillState, StepRecord]:
    """Open the valve between a source and the COPV."""
    return _fill(ctx, state, sid, None, "source", with_trace)


def pump(ctx: FillContext, state: FillState, sid: str, machine: Machine, *,
         with_trace: bool = False) -> tuple[FillState, StepRecord]:
    """Pump gas from a source into the COPV with a boost pump or compressor."""
    return _fill(ctx, state, sid, machine, "pump", with_trace)


def fill_vessel(ctx: FillContext, state: FillState, sid: str, target: str, machine: Machine | None,
                P_stop: float | None, kind: Kind, *, with_trace: bool = False) -> tuple[FillState, StepRecord]:
    """Move gas from one source into another (valve or machine) until `P_stop`, capped at the target's rating."""
    src, dst = state.sources[sid], state.sources[target]
    Vs, Vt = ctx.source_volumes[sid], ctx.source_volumes[target]
    caps = [p for p in (P_stop, ctx.source_max.get(target)) if p is not None]
    out = _transfer(ctx, src, Vs, 0.0, dst, Vt, 0.0, machine=machine, leak=0.0, m_target=None,
                    taker_max=min(caps) if caps else None, with_trace=with_trace)
    if out.status == "no_flow":
        return state, StepRecord(kind, sid, "no_flow", blocked_by=out.blocked_by, target_id=target)
    sources = dict(state.sources)
    sources[sid], sources[target] = out.giver, out.taker
    x = (_x(ctx, src, Vs) + _x(ctx, dst, Vt)) - (_x(ctx, out.giver, Vs) + _x(ctx, out.taker, Vt))
    rec = StepRecord(kind, sid, out.status, dm=out.received, exergy_destroyed=max(x + out.work, 0.0), work=out.work,
                     outlet_T_max=out.T_out_max, duration=out.duration, trace=out.trace, target_id=target)
    return FillState(state.copv, sources), rec


def recover(ctx: FillContext, state: FillState, sid: str, machine: Machine | None, *,
            with_trace: bool = False) -> tuple[FillState, StepRecord]:
    """Move gas from the COPV back into a bundle: valve if `machine` is None, else the compressor."""
    Vc, Vs = ctx.copv_volume, ctx.source_volumes[sid]
    cop, dst = state.copv, state.sources[sid]
    out = _transfer(ctx, cop, Vc, ctx.wall_C, dst, Vs, 0.0, machine=machine, leak=0.0, m_target=None,
                    copv_side="giver", taker_max=ctx.source_max.get(sid), with_trace=with_trace)
    if out.status == "no_flow":
        return state, StepRecord("recovery", sid, "no_flow", blocked_by=out.blocked_by, target_id=sid)
    new = state.with_vessels(out.giver, sid, out.taker)
    x = (_x(ctx, cop, Vc, ctx.wall_C) + _x(ctx, dst, Vs)) - (_x(ctx, out.giver, Vc, ctx.wall_C) + _x(ctx, out.taker, Vs))
    gain = settled_pressure(ctx, out.giver.m, Vc) - settled_pressure(ctx, cop.m, Vc)
    rec = StepRecord("recovery", sid, out.status, out.received, 0.0, max(x + out.work, 0.0), gain, out.work,
                     out.T_out_max, None, out.duration, trace=out.trace, target_id=sid)
    return new, rec


def vent(ctx: FillContext, state: FillState, P_end: float, *, with_trace: bool = False) -> tuple[FillState, StepRecord]:
    """Blow the COPV down to atmosphere until it reaches `P_end` (absolute, Pa)."""
    Vc, cop = ctx.copv_volume, state.copv
    out = _transfer(ctx, cop, Vc, ctx.wall_C, None, 0.0, 0.0, machine=None, leak=0.0, m_target=None,
                    copv_side="giver", sink=max(P_end, P_ATM), with_trace=with_trace)
    if out.status == "no_flow":
        return state, StepRecord("vent", None, "no_flow", blocked_by="vented")
    x = _x(ctx, cop, Vc, ctx.wall_C) - _x(ctx, out.giver, Vc, ctx.wall_C)
    gain = settled_pressure(ctx, out.giver.m, Vc) - settled_pressure(ctx, cop.m, Vc)
    rec = StepRecord("vent", None, "vented", out.moved, 0.0, max(x, 0.0), gain, duration=out.duration, trace=out.trace)
    return FillState(out.giver, state.sources), rec


def cooldown(ctx: FillContext, state: FillState, *, with_trace: bool = False) -> tuple[FillState, StepRecord]:
    T0, Vc = ctx.T0, ctx.copv_volume
    x = 0.0
    cop = state.copv
    cop1 = Vessel(cop.m, T0)
    if cop.T != T0:
        x += _x(ctx, cop, Vc, ctx.wall_C) - _x(ctx, cop1, Vc, ctx.wall_C)
    sources = {}
    for sid, v in state.sources.items():
        v1 = Vessel(v.m, T0)
        if v.T != T0:
            Vs = ctx.source_volumes[sid]
            x += _x(ctx, v, Vs) - _x(ctx, v1, Vs)
        sources[sid] = v1
    trace: list[TracePoint] = []
    if with_trace:
        trace = [(0.0, math.nan, math.nan, pressure(ctx, cop, Vc), cop.T, None),
                 (0.0, math.nan, math.nan, pressure(ctx, cop1, Vc), T0, None)]
    return FillState(cop1, sources), StepRecord("cooldown", None, "cooled", exergy_destroyed=max(x, 0.0), trace=trace)


# ---------------------------------------------------------------- internals

def _x(ctx: FillContext, v: Vessel, volume: float, wall_C: float = 0.0) -> float:
    return exergy(ctx, v, volume, wall_C)


def _fill(ctx: FillContext, state: FillState, sid: str, machine: Machine | None, kind: Kind,
          with_trace: bool) -> tuple[FillState, StepRecord]:
    src, cop = state.sources[sid], state.copv
    Vs, Vc = ctx.source_volumes[sid], ctx.copv_volume
    if cop.m >= ctx.m_target * (1 - 1e-9):
        return state, StepRecord(kind, sid, "not_needed")
    hx = ctx.exchanger if ctx.mode != "isothermal" else None
    out = _transfer(ctx, src, Vs, 0.0, cop, Vc, ctx.wall_C, machine=machine, leak=ctx.leak,
                    m_target=ctx.m_target, copv_side="taker", exchanger=hx, with_trace=with_trace)
    if out.status == "no_flow":
        return state, StepRecord(kind, sid, "no_flow", blocked_by=out.blocked_by)
    new = state.with_vessels(out.taker, sid, out.giver)
    x = (_x(ctx, src, Vs) + _x(ctx, cop, Vc, ctx.wall_C)) - (_x(ctx, out.giver, Vs) + _x(ctx, out.taker, Vc, ctx.wall_C))
    gain = settled_pressure(ctx, out.taker.m, Vc) - settled_pressure(ctx, cop.m, Vc)
    rec = StepRecord(kind, sid, out.status, dm=out.received, leaked=out.moved - out.received,
                     exergy_destroyed=max(x + out.work + out.hx_work, 0.0), settled_gain=gain, work=out.work,
                     outlet_T_max=out.T_out_max, duration=out.duration, hx_duty=out.hx_duty, hx_T=out.hx_T,
                     trace=out.trace, hx_work=out.hx_work)
    return new, rec


@dataclass
class _Out:
    status: Status
    moved: float  # kg that left the giver
    received: float  # kg that reached the taker
    giver: Vessel
    taker: Vessel | None
    work: float = 0.0
    T_out_max: float | None = None
    blocked_by: Status | None = None
    duration: float | None = None
    hx_duty: float = 0.0
    hx_work: float = 0.0  # J, minimum chiller work for the heat exchanger
    hx_T: tuple[float, float] | None = None
    trace: list[TracePoint] = field(default_factory=list)


THROTTLE_COOLING = 50.0  # K, allowance for Joule-Thomson cooling when hinting a temperature after a valve


def reach(mc: Machine, P_src: float) -> float:
    """Highest discharge pressure the machine (train) makes from gas at `P_src`, Pa."""
    P_in = min(reach(mc.feed, P_src) if mc.feed is not None else P_src, mc.inlet_max)
    return min(mc.outlet_max, mc.max_ratio * P_in)


def _interstage(mc: Machine, P_src: float, P_dis: float) -> float:
    """Pressure the feed machine delivers into `mc`'s inlet.

    Equal pressure ratio per stage over the whole train (the minimum-work split), kept high enough for `mc`
    to run and reach `P_dis`, and no higher than the feed can make or `mc` accepts.
    """
    up = mc.feed.train
    P_first = min(P_src, up[0].inlet_max)
    n_up = sum(m.stages for m in up)
    P_eq = P_first * (P_dis / P_first) ** (n_up / (n_up + mc.stages)) if P_dis > P_first else P_first
    lo = max(mc.inlet_min, P_dis / mc.max_ratio)
    hi = min(reach(mc.feed, P_src), mc.inlet_max)
    return min(max(P_eq, lo), hi)


def _machine_limits(mc: Machine, P_src: float, P_dis: float) -> list[tuple[float, Status]]:
    """Distances (bar) to the train's limits, drawing from `P_src` and delivering `P_dis`."""
    limits: list[tuple[float, Status]] = []
    P = P_in = P_src
    for m in mc.train:  # every machine needs its minimum inlet; the one before it sets what it gets
        limits.append(((P - m.inlet_min) / 1e5, "inlet_limit"))
        P_in = min(P, m.inlet_max)
        P = min(m.outlet_max, m.max_ratio * P_in)
    limits.append(((mc.outlet_max - P_dis) / 1e5, "outlet_limit"))
    limits.append(((mc.max_ratio * P_in - P_dis) / 1e5, "ratio_limit"))
    return limits


def compress(f: Fluid, T0: float, mc: Machine, g: GasState, P_dis: float) -> tuple[float, float, float, float]:
    """Gas from state `g` through the machine (train) to `P_dis`: (h_out, work per kg, hottest discharge T, inlet P)."""
    if mc.feed is None:
        return _compress_one(f, T0, mc, g, P_dis)
    P_mid = _interstage(mc, g.P, P_dis)
    h1, w1, T1, P_in = compress(f, T0, mc.feed, g, P_mid)
    mid = f.at_Ph(h1, P_mid, T_hint=T1 - THROTTLE_COOLING)  # no cooler between the machines
    h2, w2, T2, _ = _compress_one(f, T0, mc, mid, P_dis)
    return h2, w1 + w2, max(T1, T2), P_in


def _compress_one(f: Fluid, T0: float, mc: Machine, g: GasState, P_dis: float) -> tuple[float, float, float, float]:
    if g.P > mc.inlet_max:  # inlet regulator
        P_in, inlet = mc.inlet_max, f.at_Ph(g.h, mc.inlet_max, T_hint=g.T - THROTTLE_COOLING)
    else:
        P_in, inlet = g.P, g
    if P_dis <= P_in:  # nothing to compress: the gas just flows through
        return inlet.h, 0.0, inlet.T, P_in
    r = (P_dis / P_in) ** (1 / mc.stages)
    h, s, P, T_in, T_out, w = inlet.h, inlet.s, P_in, inlet.T, inlet.T, 0.0
    for i in range(mc.stages):
        P2 = P * r
        h2 = h + (f.h_Ps(P2, s, T_hint=T_in) - h) / mc.efficiency  # compression only heats the gas
        w += h2 - h
        if mc.intercooled and i < mc.stages - 1:
            cooled = f.at_PT(P2, T0)
            h, s, T_in = cooled.h, cooled.s, T0
        else:
            out = f.at_Ph(h2, P2, T_hint=T_in)
            h, s, T_in, T_out = h2, out.s, out.T, out.T
        P = P2
    return h, w, T_out, P_in


def exchange(f: Fluid, hx: Exchanger, h_in: float, P: float, T_hint: float = 0.0) -> tuple[float, float, float]:
    """Gas through the heat exchanger at pressure P: (h_out, T_out, T_in). `T_hint`: lower bound on T_in."""
    T_in = f.at_Ph(h_in, P, T_hint=T_hint).T
    T_out = hx.exit_T(T_in)
    return f.at_PT(P, T_out).h, T_out, T_in


def _chiller_work(T0: float, q: float, T_sink: float) -> float:
    """Minimum work to remove heat q at T_sink below ambient (or to supply it above ambient)."""
    if q > 0 and T_sink < T0:
        return q * (T0 / T_sink - 1)
    if q < 0 and T_sink > T0:
        return -q * (1 - T0 / T_sink)
    return 0.0


def _transfer(ctx: FillContext, giver: Vessel, Vg: float, Cg: float, taker: Vessel | None, Vt: float, Ct: float, *,
              machine: Machine | None, leak: float, m_target: float | None, copv_side: CopvSide = None,
              taker_max: float | None = None, sink: float | None = None, exchanger: Exchanger | None = None,
              with_trace: bool) -> _Out:
    """Move gas until a limit is hit. With `taker=None` the gas vents to atmosphere until the giver reaches `sink`.

    `taker_max` stops the transfer when the taker reaches that pressure (status "filled")."""
    f, T0 = ctx.fluid, ctx.T0
    iso = ctx.mode == "isothermal"
    keep = 1.0 - leak
    timing = ctx.timing

    if iso and machine is None:
        return _isothermal_valve(ctx, giver, Vg, taker, Vt, keep, m_target, taker_max, sink, copv_side, with_trace)

    def outflow(G: GasState, P_dis: float):
        """(h into the taker, machine work/kg, machine discharge T, machine inlet P, HX duty/kg, HX outlet T)."""
        if machine is None:
            h, w, T_dis, P_in = G.h, 0.0, G.T, G.P
            hint = G.T - THROTTLE_COOLING
        else:
            h, w, T_dis, P_in = compress(f, T0, machine, G, P_dis)
            hint = min(T_dis, G.T) - THROTTLE_COOLING
        if exchanger is None:
            return h, w, T_dis, P_in, 0.0, None
        h_out, T_hx, _ = exchange(f, exchanger, h, P_dis, T_hint=hint)
        return h_out, w, T_dis, P_in, h - h_out, T_hx

    def margin(G: GasState, Tk: GasState | None, mt: float, P_in: float) -> tuple[float, Status]:
        """Smallest distance to a stop condition (positive while the transfer can go on)."""
        if taker is None:
            return (G.P - sink) / 1e5, "vented"
        if machine is None:
            limits = [((G.P - Tk.P) / 1e5, "equalized")]
        else:
            limits = _machine_limits(machine, G.P, Tk.P)
        if m_target is not None:
            limits.append(((m_target - mt) / m_target * 100, "target_reached"))
        if taker_max is not None:
            limits.append(((taker_max - Tk.P) / 1e5, "filled"))
        return min(limits)

    G = f.at_DT(giver.m / Vg, giver.T)
    Tk = f.at_DT(taker.m / Vt, taker.T) if taker is not None else None
    P_down0 = Tk.P if Tk is not None else P_ATM
    sg = G.s  # the gas left in a wall-less giver keeps its entropy
    mg = giver.m
    mt = taker.m if taker is not None else 0.0
    Eg = mg * G.u + Cg * (giver.T - T0)
    Et = mt * Tk.u + Ct * (taker.T - T0) if taker is not None else 0.0
    h0, w0, T_out0, P_in0, q0, Thx0 = outflow(G, P_down0)
    m0 = margin(G, Tk, mt, P_in0)
    if m0[0] <= 1e-5:  # already at a limit (root-solve tolerance of an earlier step)
        return _Out("no_flow", 0.0, 0.0, giver, taker, blocked_by=m0[1])

    # Temperature change per kg over the last increment: extrapolated Newton starting guesses.
    slope = {"giver": 0.0, "taker": 0.0}

    def advance(d: float):
        mg1, mt1 = mg - d, mt + keep * d
        g_guess = G.T + slope["giver"] * d
        if iso:
            G1, Eg1 = f.at_DT(mg1 / Vg, T0), 0.0
        elif Cg == 0:
            G1, Eg1 = f.at_Ds(mg1 / Vg, sg, g_guess), 0.0
        else:  # giver with a wall: predictor-corrector on its energy balance
            Gp = f.at_DE(mg1 / Vg, mg1, Eg - G.h * d, Cg, T0, g_guess)
            Eg1 = Eg - 0.5 * (G.h + Gp.h) * d
            G1 = f.at_DE(mg1 / Vg, mg1, Eg1, Cg, T0, Gp.T)
        if taker is None:
            return (G1, None, Eg1, 0.0) + outflow(G1, P_ATM)
        if iso:
            Tk1, Et1 = f.at_DT(mt1 / Vt, T0), 0.0
            out1 = outflow(G1, Tk1.P)
        else:
            out1 = outflow(G1, Tk.P)
            Et1 = Et + 0.5 * (h0 + out1[0]) * keep * d
            Tk1 = f.at_DE(mt1 / Vt, mt1, Et1, Ct, T0, Tk.T + slope["taker"] * d)
            if machine is not None or exchanger is not None:  # discharge pressure at the end of the increment
                out1 = outflow(G1, Tk1.P)
                Et1 = Et + 0.5 * (h0 + out1[0]) * keep * d
                Tk1 = f.at_DE(mt1 / Vt, mt1, Et1, Ct, T0, Tk1.T)
        return (G1, Tk1, Eg1, Et1) + out1

    def margin_at(d: float) -> float:
        G1, Tk1, _, _, _, _, _, Pin1, _, _ = advance(d)
        return margin(G1, Tk1, mt + keep * d, Pin1)[0]

    def step_time(Ga: GasState, Gb: GasState, Pd_a: float, Pd_b: float, Pc_a: float, Pc_b: float,
                  d: float, ends_at_zero_dp: bool) -> float:
        if timing is None:
            return 0.0
        if machine is not None and machine.throughput > 0:
            dt = d / machine.throughput
        elif ends_at_zero_dp:  # flow ~ sqrt(dP) and dP ~ linear in mass near equalization
            dt = 2 * d / max(orifice_flow(timing.cd_area, Ga.P, Ga.rho, Ga.cp / Ga.cv, Pd_a), 1e-12)
        else:
            mdot = orifice_flow(timing.cd_area, 0.5 * (Ga.P + Gb.P), 0.5 * (Ga.rho + Gb.rho), Ga.cp / Ga.cv,
                                0.5 * (Pd_a + Pd_b))
            dt = d / max(mdot, 1e-12)
        if timing.rate_limit > 0 and copv_side is not None:
            dt = max(dt, abs(Pc_b - Pc_a) / timing.rate_limit)
        return dt

    # Increment size from a rough estimate of how much gas can move.
    caps = []
    if taker_max is not None:
        caps.append((f.rho_PT(taker_max, T0) * Vt - mt) / keep)
    if taker is None:
        caps.append(mg - f.rho_PT(sink, T0) * Vg)
    elif machine is None:
        caps.append(((mg + mt) / (Vg + Vt) * Vt - mt) / keep)
    else:
        caps.append(mg - f.rho_PT(machine.train[0].inlet_min, T0) * Vg)
        caps.append((f.rho_PT(machine.outlet_max, T0) * Vt - mt) / keep)
    if m_target is not None:
        caps.append((m_target - mt) / keep)
    positive = [c for c in caps if c > 0]
    dx = (min(positive) if positive else 0.05 * mg) / ctx.increments
    sample_every = max(1, ctx.increments // 25)

    def copv_p(Gs: GasState, Tks: GasState | None) -> float:
        return Gs.P if copv_side == "giver" else Tks.P if copv_side == "taker" else 0.0

    timed = timing is not None

    def point(moved: float, Gs: GasState, Tks: GasState | None, t: float) -> TracePoint:
        return (moved * keep, Gs.P, Gs.T, Tks.P if Tks is not None else None, Tks.T if Tks is not None else None,
                t if timed else None)

    trace: list[TracePoint] = [point(0.0, G, Tk, 0.0)] if with_trace else []
    moved = work = duration = hx_duty = hx_work = 0.0
    T_out_max = T_out0 if machine is not None else None
    hx_T = (Thx0, Thx0) if Thx0 is not None else None
    status: Status = "equalized"
    m_now = m0[0]
    for k in range(1, 100 * ctx.increments):
        step = dx
        G1, Tk1, Eg1, Et1, h1, w1, Tout1, Pin1, q1, Thx1 = advance(step)
        m1, _ = margin(G1, Tk1, mt + keep * step, Pin1)
        done = m1 <= 0
        if done:
            step = _illinois(margin_at, 0.0, step, m_now, m1, tol_x=1e-12 * mg, tol_g=1e-7)
            G1, Tk1, Eg1, Et1, h1, w1, Tout1, Pin1, q1, Thx1 = advance(step)
            status = margin(G1, Tk1, mt + keep * step, Pin1)[1]
        if timed:
            Pd_a = Tk.P if Tk is not None else P_ATM
            Pd_b = Tk1.P if Tk1 is not None else P_ATM
            zero_dp = done and (status == "equalized" or (taker is None and sink <= P_ATM * 1.0001))
            duration += step_time(G, G1, Pd_a, Pd_b, copv_p(G, Tk), copv_p(G1, Tk1), step, zero_dp)
        work += 0.5 * (w0 + w1) * step
        if exchanger is not None:
            dq = 0.5 * (q0 + q1) * keep * step
            hx_duty += dq
            hx_work += _chiller_work(T0, dq, exchanger.sink_T(0.5 * (Thx0 + Thx1)))
            hx_T = (min(hx_T[0], Thx1), max(hx_T[1], Thx1))
        if step > 0:
            slope["giver"] = (G1.T - G.T) / step
            if Tk is not None:
                slope["taker"] = (Tk1.T - Tk.T) / step
        mg, mt, Eg, Et, G, Tk = mg - step, mt + keep * step, Eg1, Et1, G1, Tk1
        h0, w0, q0, Thx0 = h1, w1, q1, Thx1
        moved += step
        if machine is not None:
            T_out_max = max(T_out_max, Tout1)
        if done:
            break
        m_now = m1
        if with_trace and k % sample_every == 0:
            trace.append(point(moved, G, Tk, duration))
        if k % ctx.increments == 0:
            dx *= 2  # the estimate was too small; widen the stride
    if with_trace:
        trace.append(point(moved, G, Tk, duration))
    taker1 = Vessel(mt, Tk.T) if taker is not None else None
    return _Out(status, moved, moved * keep, Vessel(mg, G.T), taker1, work, T_out_max, None,
                duration if timed else None, hx_duty, hx_work, hx_T, trace)


def _isothermal_valve(ctx: FillContext, giver: Vessel, Vg: float, taker: Vessel | None, Vt: float, keep: float,
                      m_target: float | None, taker_max: float | None, sink: float | None, copv_side: CopvSide,
                      with_trace: bool) -> _Out:
    # Same pressure and temperature means same density, so the end state is closed-form:
    # (mg - g/keep)/Vg = (mt + g)/Vt for the mass g that reaches the taker.
    T0, f = ctx.T0, ctx.fluid
    if taker is None:  # venting
        if f.P_DT(giver.m / Vg, T0) <= sink:
            return _Out("no_flow", 0.0, 0.0, giver, None, blocked_by="vented")
        moved = giver.m - f.rho_PT(sink, T0) * Vg
        g, status = moved, "vented"
    else:
        if f.P_DT(giver.m / Vg, T0) <= f.P_DT(taker.m / Vt, T0):
            return _Out("no_flow", 0.0, 0.0, giver, taker, blocked_by="equalized")
        if taker_max is not None and f.P_DT(taker.m / Vt, T0) >= taker_max - 1.0:  # within 1 Pa
            return _Out("no_flow", 0.0, 0.0, giver, taker, blocked_by="filled")
        g = (giver.m * Vt - taker.m * Vg) / (Vt / keep + Vg)
        status = "equalized"
        if m_target is not None and taker.m + g >= m_target:
            status, g = "target_reached", m_target - taker.m
        if taker_max is not None and taker.m + g >= f.rho_PT(taker_max, T0) * Vt:
            status, g = "filled", f.rho_PT(taker_max, T0) * Vt - taker.m
        moved = g / keep

    def states(x: float):
        """Giver state and downstream pressure after `x` kg has left the giver."""
        G = f.at_DT((giver.m - x) / Vg, T0)
        P_down = f.P_DT((taker.m + keep * x) / Vt, T0) if taker is not None else P_ATM
        return G, P_down

    timing = ctx.timing
    duration = 0.0 if timing is not None else None
    trace: list[TracePoint] = []

    def point(x: float, G: GasState, P_down: float, t: float | None) -> TracePoint:
        return (x * keep, G.P, T0, P_down if taker is not None else None, T0 if taker is not None else None, t)

    if timing is not None or with_trace:
        n = 60
        Ga, Pa = states(0.0)
        if with_trace:
            trace.append(point(0.0, Ga, Pa, duration))
        for i in range(1, n + 1):
            Gb, Pb = states(moved * i / n)
            if timing is not None:
                d = moved / n
                if i == n and (status == "equalized" or (taker is None and sink <= P_ATM * 1.0001)):
                    dt = 2 * d / max(orifice_flow(timing.cd_area, Ga.P, Ga.rho, Ga.cp / Ga.cv, Pa), 1e-12)
                else:
                    mdot = orifice_flow(timing.cd_area, 0.5 * (Ga.P + Gb.P), 0.5 * (Ga.rho + Gb.rho), Ga.cp / Ga.cv,
                                        0.5 * (Pa + Pb))
                    dt = d / max(mdot, 1e-12)
                if timing.rate_limit > 0 and copv_side is not None:
                    Pc_a, Pc_b = (Ga.P, Gb.P) if copv_side == "giver" else (Pa, Pb)
                    dt = max(dt, abs(Pc_b - Pc_a) / timing.rate_limit)
                duration += dt
            if with_trace and i % 6 == 0:
                trace.append(point(moved * i / n, Gb, Pb, duration))
            Ga, Pa = Gb, Pb
    taker1 = Vessel(taker.m + g, T0) if taker is not None else None
    return _Out(status, moved, g, Vessel(giver.m - moved, T0), taker1, duration=duration, trace=trace)


def _illinois(g, a: float, b: float, ga: float, gb: float, tol_x: float, tol_g: float, max_iter: int = 80) -> float:
    """Root of g on [a, b] with g(a) > 0 >= g(b) (Illinois regula falsi)."""
    side = 0
    c = b
    for _ in range(max_iter):
        c = (a * gb - b * ga) / (gb - ga)
        gc = g(c)
        if abs(gc) < tol_g or b - a < tol_x:
            return c
        if gc * gb > 0:
            b, gb = c, gc
            if side == -1:
                ga /= 2
            side = -1
        else:
            a, ga = c, gc
            if side == 1:
                gb /= 2
            side = 1
    return c
