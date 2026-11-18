"""Turns hydrostatic test requests into per-cycle results, totals, a pressure-time trace and volume checks."""

from __future__ import annotations

from .. import fluids
from ..config import c_to_k
from ..notes import NoteOut, assumption, critical, energy_text, note
from ..stored_energy.calculate import to_wall
from ..stored_energy.physics import gas_energy
from ..test_cycles import CycleSpec, passes, repeat_sum, run_cycles
from ..vessel import Tank, density
from .models import (
    CycleOut,
    HydroTestRequest,
    HydroTestResponse,
    TimePointOut,
    TotalsOut,
    VolumeCheckRequest,
    VolumeCheckResponse,
    VolumeRunOut,
)
from .physics import gas_pocket_volume, peak_energy, pumped_with_gas_pocket, tank_volume_from_transfer, transfer

AGREEMENT_PCT = 2.0  # press vs depress, or repeated runs, further apart than this get a note


def _liquid_reference(fluid: str, T: float) -> fluids.State:
    st0 = fluids.state_PT(fluid, fluids.P_GAUGE_REF, T)
    if st0.phase != "liquid":
        raise ValueError(f"{fluid} is not a liquid at 1 bar a and {T - 273.15:g} °C; choose a lower temperature.")
    return st0


def hydro_test(req: HydroTestRequest) -> HydroTestResponse:
    T = c_to_k(req.temp_c)
    tank = Tank(V0=req.volume_l / 1e3, wall=to_wall(req.wall) if req.wall else None)
    st0 = _liquid_reference(req.fluid, T)
    rho0 = st0.rho
    specs = [CycleSpec(c.target_barg * 1e5, c.hold_min, c.vent_barg * 1e5, c.vent_hold_min,
                       None if c.measured_end_hold_barg is None else c.measured_end_hold_barg * 1e5) for c in req.cycles]
    for s in specs:
        fluids.check_range(req.fluid, fluids.P_GAUGE_REF + s.target, T)
    runs, trace = run_cycles(req.fluid, tank, T, passes(specs, req.repeat), req.pressurisation_bar_min * 1e5, req.vent_bar_min * 1e5,
                             phase="liquid")
    notes: list[NoteOut] = []

    cycles: list[CycleOut] = []
    for r in runs:
        up = transfer(req.fluid, tank, T, r.start, r.target)
        e = peak_energy(req.fluid, tank, T, r.target)
        cycles.append(CycleOut(
            index=r.index, start_barg=r.start / 1e5, target_barg=r.target / 1e5, hold_min=r.hold_min,
            end_hold_barg=r.end_hold / 1e5, vent_barg=r.vent / 1e5, vent_hold_min=r.vent_hold_min,
            hold_drop_bar=(r.target - r.end_hold) / 1e5, leak_rate_bar_min=r.leak_rate_bar_min,
            pumped_kg=up.mass_kg, pumped_l=up.volume_m3 * 1e3, pumped_compressibility_l=up.compressibility_m3 * 1e3,
            pumped_tank_l=up.tank_m3 * 1e3, returned_kg=r.vented_kg, returned_l=r.vented_kg / rho0 * 1e3,
            leaked_l=r.leaked_kg / rho0 * 1e3,
            energy_kj=e.total_j / 1e3, energy_fluid_kj=e.fluid_j / 1e3,
            energy_wall_kj=None if e.wall_j is None else e.wall_j / 1e3, duration_min=r.duration_min,
        ))

    k, n = len(specs), req.repeat
    total = lambda attr: repeat_sum([getattr(c, attr) for c in cycles], k, n)  # noqa: E731
    pumped_l, returned_l, leaked_l = total("pumped_l"), total("returned_l"), total("leaked_l")
    totals = TotalsOut(test_pressure_barg=max(c.target_barg for c in cycles), cycle_count=k * n,
                       pumped_kg=total("pumped_kg"), pumped_l=pumped_l, returned_kg=total("returned_kg"),
                       returned_l=returned_l, leaked_l=leaked_l, retained_l=pumped_l - returned_l - leaked_l,
                       peak_energy_kj=max(c.energy_kj for c in cycles), duration_min=total("duration_min"))
    cycles = cycles[:k]  # one pass; the timeline keeps the simulated passes

    if tank.wall is None:
        notes.append(assumption("No tank geometry given: the tank is treated as rigid, so only the liquid's compressibility is counted."))
    elif tank.wall.t / tank.wall.D > 0.1:
        notes.append(note("Wall thickness is over 10 % of the diameter: thin-wall theory becomes inaccurate (it overstates "
                          "the tank expansion)."))
    notes.append(assumption("Isothermal, linear-elastic tank and no trapped air. Use the volume check to find trapped air."))

    return HydroTestResponse(
        density_kg_m3=rho0, bulk_modulus_mpa=1 / st0.kappa_T / 1e6,
        tank_dilation_per_bar=tank.dilation * 1e5 if tank.wall else None,
        cycles=cycles, totals=totals,
        timeline=[TimePointOut(t_min=p.t_min, pressure_barg=p.p_gauge / 1e5, phase=p.phase, cycle=p.cycle) for p in trace],
        notes=notes,
    )


def volume_check(req: VolumeCheckRequest) -> VolumeCheckResponse:
    T = c_to_k(req.temp_c)
    _liquid_reference(req.fluid, T)
    wall = to_wall(req.wall) if req.wall else None
    rho_ref = density(req.fluid, 0.0, T, "liquid")
    pocket = req.mode == "gas_pocket"
    if pocket and req.volume_l is None:
        raise ValueError("Enter the tank volume to work out the gas pocket.")
    tank = Tank(req.volume_l / 1e3, wall) if req.volume_l is not None else None
    notes: list[NoteOut] = []

    def solve(p1: float, p2: float, litres: float) -> float:
        m = litres / 1e3 * rho_ref
        if not pocket:
            return tank_volume_from_transfer(req.fluid, wall, T, p1, p2, m) * 1e3
        vg1 = gas_pocket_volume(req.fluid, tank, T, p1, p2, m, req.pocket_gas)
        return vg1 * density(req.pocket_gas, p1, T, "gas") / density(req.pocket_gas, 0.0, T, "gas") * 1e3  # at 1 bar a

    runs: list[VolumeRunOut] = []
    values: list[float] = []
    for i, r in enumerate(req.runs, start=1):
        p1, p2 = r.from_barg * 1e5, r.to_barg * 1e5
        if p2 <= p1:
            raise ValueError(f"Run {i}: the upper pressure must be above the lower pressure.")
        fluids.check_range(req.fluid, fluids.P_GAUGE_REF + p2, T)
        v_in = solve(p1, p2, r.pumped_l)
        v_out = solve(p1, p2, r.returned_l) if r.returned_l is not None else None
        values += [v_in] + ([v_out] if v_out is not None else [])
        mid = v_in if v_out is None else 0.5 * (v_in + v_out)
        diff = None if v_out is None or mid == 0 else (v_in - v_out) / abs(mid) * 100
        if pocket:
            expected = pumped_with_gas_pocket(req.fluid, tank, T, p1, p2, 0.0, req.pocket_gas) / rho_ref * 1e3
        else:
            expected = transfer(req.fluid, tank, T, p1, p2).volume_m3 * 1e3 if tank else None
        runs.append(VolumeRunOut(index=i, from_press_l=v_in, from_depress_l=v_out, difference_pct=diff, expected_pumped_l=expected))
        if diff is not None and abs(diff) > AGREEMENT_PCT:
            notes.append(note(f"Run {i}: pressing and depressing disagree by {diff:+.1f} %. More going in than coming back "
                              "points to a leak, gas dissolving, a temperature change or permanent set."))

    mean = sum(values) / len(values)
    spread = (max(values) - min(values)) / abs(mean) * 100 if len(values) > 1 and mean != 0 else None
    if spread is not None and spread > AGREEMENT_PCT:
        notes.append(note(f"The measurements spread over {spread:.1f} % of the mean. Repeat until they settle; a steady drift "
                          "from run to run suggests gas dissolving or a leak."))

    pocket_kj = liquid_kj = None
    if pocket:
        p_max = max(r.to_barg for r in req.runs) * 1e5
        liquid_kj = peak_energy(req.fluid, tank, T, p_max).total_j / 1e3
        if mean > 0:
            v_at_pmax = mean / 1e3 * density(req.pocket_gas, 0.0, T, "gas") / density(req.pocket_gas, p_max, T, "gas")
            pocket_kj = gas_energy(req.pocket_gas, fluids.P_GAUGE_REF + p_max, T, fluids.P_GAUGE_REF, v_at_pmax).real_j / 1e3
            if pocket_kj >= liquid_kj:
                notes.append(critical(
                    f"Trapped gas: {mean:.3g} L (at 1 bar a) stores about {energy_text(pocket_kj)} at {p_max / 1e5:g} barg, "
                    f"{pocket_kj / liquid_kj:.3g} times the liquid's {energy_text(liquid_kj)}. Bleed the gas out before testing."))
        else:
            notes.append(note("Less liquid went in than a gas-free tank of this volume needs: the tank is smaller than "
                              "entered, stiffer than the wall data says, or the flow measurement is off."))
        notes.append(assumption("Gas compressed isothermally at the test temperature; gas dissolving into the liquid is ignored."))
    else:
        notes.append(assumption("Assumes the tank is completely full of liquid. Any trapped gas makes the tank look larger; if "
                          "you know the tank volume, use the gas pocket mode instead."))

    return VolumeCheckResponse(mode=req.mode, runs=runs, mean_l=mean, spread_pct=spread, count=len(values),
                               pocket_energy_kj=pocket_kj, liquid_energy_kj=liquid_kj, notes=notes)
