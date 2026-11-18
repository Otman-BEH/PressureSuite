"""Pressure test cycles, shared by the hydrostatic and gas test tools. Pure functions, gauge Pa relative to 1 bar a.

Each cycle: pressurise from the current pressure to the target, hold, vent down to the vent pressure, hold again
there (if a hold time is given).

Leak rate is an output. If the pressure measured at the end of the hold at target is given, the hold runs from the
target down to that pressure, the leak rate is (target - measured) / hold time in bar/min, and the vent starts from the
measured pressure. The mass lost is m(target) - m(measured) (see `vessel`).

The vessel is isothermal (fill and vent heating are not modelled) and linear-elastic.
"""

from __future__ import annotations

from dataclasses import dataclass

from .vessel import Phase, Tank, contents


@dataclass(frozen=True, slots=True)
class CycleSpec:
    target: float  # Pa gauge
    hold_min: float
    vent: float  # Pa gauge
    vent_hold_min: float = 0.0
    measured_end_hold: float | None = None  # Pa gauge, measured at the end of the hold at target


@dataclass(frozen=True, slots=True)
class CycleRun:
    index: int
    start: float  # Pa gauge, at the start of pressurisation
    target: float
    end_hold: float  # measured end of the hold at target (= target when not measured)
    vent: float
    hold_min: float
    vent_hold_min: float
    filled_kg: float  # put in: start -> target
    vented_kg: float  # let out: end of hold -> vent pressure
    leaked_kg: float  # lost during the hold (from the measured drop)
    leak_rate_bar_min: float | None  # None when no end-of-hold pressure was measured
    duration_min: float


@dataclass(frozen=True, slots=True)
class TimePoint:
    t_min: float
    p_gauge: float  # Pa
    phase: str
    cycle: int


def check_plan(specs: list[CycleSpec]) -> None:
    start = 0.0
    for i, c in enumerate(specs, start=1):
        if c.vent >= c.target:
            raise ValueError(f"Cycle {i}: vent-down pressure ({c.vent / 1e5:g} barg) must be below the target "
                             f"({c.target / 1e5:g} barg).")
        if c.target < start:
            raise ValueError(f"Cycle {i}: target ({c.target / 1e5:g} barg) is below the pressure the previous cycle vented "
                             f"to ({start / 1e5:g} barg).")
        if c.measured_end_hold is not None:
            if c.measured_end_hold > c.target:
                raise ValueError(f"Cycle {i}: the measured end-of-hold pressure ({c.measured_end_hold / 1e5:g} barg) is "
                                 f"above the target ({c.target / 1e5:g} barg). A rise usually means warming, not a leak.")
            if c.hold_min <= 0:
                raise ValueError(f"Cycle {i}: enter a hold time to work out the leak rate from the measured pressure.")
        start = c.vent


def passes(specs: list[CycleSpec], repeat: int) -> list[CycleSpec]:
    """The cycles to simulate for `repeat` passes of the list: one pass, or two when repeated.

    From the second pass on, every pass starts at the last cycle's vent pressure, so passes 2..N are identical:
    simulating two is enough, and `repeat_sum` scales the second up.
    """
    if repeat < 1:
        raise ValueError("Repeat count must be at least 1.")
    if repeat > 1 and specs[0].target < specs[-1].vent:
        raise ValueError(f"To repeat the cycles, the first target ({specs[0].target / 1e5:g} barg) must not be below "
                         f"the last vent-down pressure ({specs[-1].vent / 1e5:g} barg).")
    return specs * min(repeat, 2)


def repeat_sum(values: list[float], k: int, repeat: int) -> float:
    """Total over `repeat` passes of k cycles, from per-cycle values of the simulated passes (see `passes`)."""
    return sum(values[:k]) + (repeat - 1) * sum(values[k:2 * k])


def leak_rate_bar_min(p_start: float, p_end: float, minutes: float) -> float:
    """Average pressure decay over a hold, bar/min."""
    if minutes <= 0:
        raise ValueError("Hold time must be positive.")
    return (p_start - p_end) / 1e5 / minutes


def run_cycles(fluid: str, tank: Tank, T: float, specs: list[CycleSpec], pressurisation_pa_min: float, vent_pa_min: float,
               phase: Phase | None = None) -> tuple[list[CycleRun], list[TimePoint]]:
    if pressurisation_pa_min <= 0 or vent_pa_min <= 0:
        raise ValueError("Pressurisation and vent rates must be positive.")
    check_plan(specs)
    m = lambda p: contents(fluid, tank, T, p, phase)  # noqa: E731

    t, p = 0.0, 0.0
    pts = [TimePoint(0.0, 0.0, "Start", 0)]
    runs: list[CycleRun] = []
    for i, c in enumerate(specs, start=1):
        t_cycle, start = t, p
        t += max(c.target - p, 0.0) / pressurisation_pa_min
        pts.append(TimePoint(t, c.target, "Pressurisation", i))
        end_hold = c.target if c.measured_end_hold is None else c.measured_end_hold
        if c.hold_min > 0:
            t += c.hold_min
            pts.append(TimePoint(t, end_hold, "Hold" if c.measured_end_hold is None else "Hold (measured)", i))
        vent = min(c.vent, end_hold)
        t += max(end_hold - vent, 0.0) / vent_pa_min
        pts.append(TimePoint(t, vent, "Vent", i))
        if c.vent_hold_min > 0:
            t += c.vent_hold_min
            pts.append(TimePoint(t, vent, "Hold at vent", i))
        rate = None if c.measured_end_hold is None else leak_rate_bar_min(c.target, end_hold, c.hold_min)
        runs.append(CycleRun(index=i, start=start, target=c.target, end_hold=end_hold, vent=vent, hold_min=c.hold_min,
                             vent_hold_min=c.vent_hold_min, filled_kg=m(c.target) - m(start), vented_kg=m(end_hold) - m(vent),
                             leaked_kg=m(c.target) - m(end_hold), leak_rate_bar_min=rate, duration_min=t - t_cycle))
        p = vent
    return runs, pts
