"""Gas (pneumatic) acceptance test: gas per cycle, stored energy, timing and how many supply bundles it takes.

Same cycle model as the hydrostatic test (see `test_cycles`), with the vessel holding a real gas at a fixed
temperature: the targets are settled pressures, so fill heating is not modelled.

Supply estimate. Gas used over the test is everything put into the vessel (vented, leaked or left inside at the end).
- Decanting (valves only): a bundle can at best be drawn down to the pressure it is filling to, so each bundle gives
  rho(P_bundle) V_b - rho(P_max target) V_b. Not possible when the bundle is not above the highest target.
- With a booster: each bundle can be drawn down to the booster's residual pressure.
Both round up to whole bundles and assume every cycle can use what is left in a part-used bundle; the COPV Cascade
Fill tab plans an actual cascade.
"""

from __future__ import annotations

import math

from .. import fluids
from ..config import P_ATM, T_NORMAL, c_to_k
from ..notes import NoteOut, assumption, critical, energy_text, note
from ..stored_energy.calculate import to_wall
from ..stored_energy.physics import gas_energy, tnt_mass
from ..test_cycles import CycleSpec, passes, repeat_sum, run_cycles
from ..vessel import Tank, contents
from ..hydro_test.models import TimePointOut
from .models import (
    BUNDLE_PRESSURE_BARG,
    DEFAULT_BUNDLE_PRESSURE_BARG,
    GasCycleOut,
    GasTestRequest,
    GasTestResponse,
    GasTotalsOut,
    SupplyOut,
)


def bundle_pressure_for(fluid: str, override: float | None) -> float:
    return override if override is not None else BUNDLE_PRESSURE_BARG.get(fluid, DEFAULT_BUNDLE_PRESSURE_BARG)


def gas_test(req: GasTestRequest) -> GasTestResponse:
    T = c_to_k(req.temp_c)
    tank = Tank(V0=req.volume_l / 1e3, wall=to_wall(req.wall) if req.wall else None)
    if fluids.state_PT(req.fluid, fluids.P_GAUGE_REF, T).phase != "gas":
        raise ValueError(f"{req.fluid} is not a gas at 1 bar a and {req.temp_c:g} °C.")
    specs = [CycleSpec(c.target_barg * 1e5, c.hold_min, c.vent_barg * 1e5, c.vent_hold_min,
                       None if c.measured_end_hold_barg is None else c.measured_end_hold_barg * 1e5) for c in req.cycles]
    for s in specs:
        fluids.check_range(req.fluid, fluids.P_GAUGE_REF + s.target, T)
    runs, trace = run_cycles(req.fluid, tank, T, passes(specs, req.repeat), req.pressurisation_bar_min * 1e5, req.vent_bar_min * 1e5,
                             phase="gas")
    rho_n = fluids.state_PT(req.fluid, P_ATM, T_NORMAL).rho
    notes: list[NoteOut] = []

    cycles: list[GasCycleOut] = []
    for r in runs:
        e = gas_energy(req.fluid, fluids.P_GAUGE_REF + r.target, T, fluids.P_GAUGE_REF, tank.volume(r.target)).real_j
        cycles.append(GasCycleOut(
            index=r.index, start_barg=r.start / 1e5, target_barg=r.target / 1e5, hold_min=r.hold_min,
            end_hold_barg=r.end_hold / 1e5, vent_barg=r.vent / 1e5, vent_hold_min=r.vent_hold_min,
            hold_drop_bar=(r.target - r.end_hold) / 1e5, leak_rate_bar_min=r.leak_rate_bar_min,
            filled_kg=r.filled_kg, filled_nm3=r.filled_kg / rho_n, vented_kg=r.vented_kg, vented_nm3=r.vented_kg / rho_n,
            leaked_kg=r.leaked_kg, energy_kj=e / 1e3, tnt_kg=tnt_mass(e), duration_min=r.duration_min,
        ))

    k, n = len(specs), req.repeat
    total = lambda attr: repeat_sum([getattr(c, attr) for c in cycles], k, n)  # noqa: E731
    used = total("filled_kg")
    left = contents(req.fluid, tank, T, runs[-1].vent) - contents(req.fluid, tank, T, 0.0)
    totals = GasTotalsOut(test_pressure_barg=max(c.target_barg for c in cycles), cycle_count=k * n, used_kg=used,
                          used_nm3=used / rho_n, vented_kg=total("vented_kg"), leaked_kg=total("leaked_kg"),
                          left_in_vessel_kg=left, peak_energy_kj=max(c.energy_kj for c in cycles),
                          duration_min=total("duration_min"))
    cycles = cycles[:k]  # one pass; the timeline keeps the simulated passes

    # Supply bundles
    sp = req.supply
    Pb = bundle_pressure_for(req.fluid, sp.bundle_pressure_barg) * 1e5
    bundle = Tank(V0=sp.bundle_volume_l / 1e3)
    fluids.check_range(req.fluid, fluids.P_GAUGE_REF + Pb, T)
    full = contents(req.fluid, bundle, T, Pb)
    empty = contents(req.fluid, bundle, T, 0.0)
    p_max = max(s.target for s in specs)
    decant_usable = full - contents(req.fluid, bundle, T, p_max) if Pb > p_max else None
    if sp.residual_barg * 1e5 >= Pb:
        raise ValueError("The booster residual pressure must be below the bundle pressure.")
    booster_usable = full - contents(req.fluid, bundle, T, sp.residual_barg * 1e5)
    supply = SupplyOut(
        bundle_pressure_barg=Pb / 1e5, bundle_volume_l=sp.bundle_volume_l, bundle_contents_kg=full - empty,
        bundle_contents_nm3=(full - empty) / rho_n, decant_usable_kg=decant_usable,
        bundles_decant=math.ceil(used / decant_usable) if decant_usable else None,
        booster_usable_kg=booster_usable, bundles_booster=math.ceil(used / booster_usable),
    )
    if decant_usable is None:
        notes.append(note(f"The highest target ({p_max / 1e5:g} barg) is not below the bundle pressure ({Pb / 1e5:g} "
                          "barg): decanting alone cannot reach it, a booster is needed."))
    notes.insert(0, critical(f"Pneumatic test: the vessel stores up to {energy_text(totals.peak_energy_kj)} "
                             f"({tnt_mass(totals.peak_energy_kj * 1e3):.3g} kg TNT), far more than a hydrostatic test at the "
                             "same pressure. Keep people out of the test area while it is pressurised."))
    notes.append(assumption("Bundle counts are rough: they assume part-used bundles keep being used. Use the COPV Fill "
                      "tab for an actual cascade plan."))
    notes.append(assumption("Targets are settled pressures at the test temperature; fill heating and vent cooling are not "
                      "modelled."))

    return GasTestResponse(
        cycles=cycles, totals=totals, supply=supply,
        timeline=[TimePointOut(t_min=p.t_min, pressure_barg=p.p_gauge / 1e5, phase=p.phase, cycle=p.cycle) for p in trace],
        notes=notes,
    )
