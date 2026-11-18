"""Leak rate from a measured hold, with the vessel and fluid of the tab it is used on."""

from __future__ import annotations

from ..config import c_to_k
from ..notes import assumption
from ..stored_energy.calculate import to_wall
from ..test_cycles import leak_rate_bar_min
from ..vessel import Tank, contents
from .models import FlowOut, LeakRequest, LeakResponse
from .physics import UNIT_LABELS, UNITS_FOR, mass_lost, per_unit_kg_s, phase_at_reference


def leak(req: LeakRequest) -> LeakResponse:
    T = c_to_k(req.temp_c)
    tank = Tank(V0=req.volume_l / 1e3, wall=to_wall(req.wall) if req.wall else None)
    p0, p1 = req.start_barg * 1e5, req.end_barg * 1e5
    phase = phase_at_reference(req.fluid, T)
    contents(req.fluid, tank, T, p0, phase)  # checks the state at the start pressure
    lost = mass_lost(req.fluid, tank, T, p0, p1)
    mdot = lost / (req.hold_min * 60)
    flows = [FlowOut(unit=UNIT_LABELS[u], value=mdot / per_unit_kg_s(req.fluid, T, u)) for u in UNITS_FOR[phase]]
    notes = [assumption("Assumes the temperature stayed the same during the hold. In a liquid-filled vessel 1 °C moves the "
                  "pressure by several bar, so let it settle before judging a leak.") if phase == "liquid" else
             assumption("Assumes the temperature stayed the same during the hold. 1 °C moves a gas-filled vessel's pressure by "
                  "about 0.3 %, which can hide or fake a small leak.")]
    return LeakResponse(phase=phase, rate_bar_min=leak_rate_bar_min(p0, p1, req.hold_min), drop_bar=(p0 - p1) / 1e5,
                        lost_kg=lost, mass_rate_g_min=mdot * 60e3, flows=flows, notes=notes)
