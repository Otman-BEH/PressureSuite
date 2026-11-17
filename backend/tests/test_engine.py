import math

import pytest

from pressuresuite.config import P_ATM, barg_to_pa
from pressuresuite.cascade_fill.engine import FillContext, FillState, Vessel, connect, cooldown, pressure
from pressuresuite.thermo import get_fluid

T0 = 293.15


def make(fluid="Helium", mode="adiabatic", Vs=0.6, Vc=0.05, Ps_barg=200.0, Pc_bara=1.0, target_barg=900.0,
         wall_C=0.0, increments=120, src_T=T0):
    f = get_fluid(fluid)
    ctx = FillContext(f, mode, T0, Vc, f.rho_PT(barg_to_pa(target_barg), T0) * Vc, wall_C, {"s": Vs}, increments)
    state = FillState(Vessel(f.rho_PT(Pc_bara * 1e5, T0) * Vc, T0),
                      {"s": Vessel(f.rho_PT(barg_to_pa(Ps_barg), src_T) * Vs, src_T)})
    return ctx, state


def total_energy(ctx, state, wall=0.0):
    f, Vc, Vs = ctx.fluid, ctx.copv_volume, ctx.source_volumes["s"]
    c, s = state.copv, state.sources["s"]
    return (c.m * f.at_DT(c.m / Vc, c.T).u + s.m * f.at_DT(s.m / Vs, s.T).u + wall * (c.T - T0))


@pytest.mark.parametrize("fluid", ["Helium", "Nitrogen"])
def test_isothermal_equalizes_and_conserves_mass(fluid):
    ctx, state = make(fluid, "isothermal")
    new, rec = connect(ctx, state, "s")
    assert rec.status == "equalized"
    m0 = state.copv.m + state.sources["s"].m
    assert new.copv.m + new.sources["s"].m == pytest.approx(m0, rel=1e-12)
    p_src = pressure(ctx, new.sources["s"], 0.6)
    p_cop = pressure(ctx, new.copv, 0.05)
    assert p_src == pytest.approx(p_cop, rel=1e-9)
    assert rec.exergy_destroyed > 0


@pytest.mark.parametrize("fluid", ["Helium", "Nitrogen"])
def test_adiabatic_conserves_energy_and_source_entropy(fluid):
    ctx, state = make(fluid, "adiabatic")
    new, rec = connect(ctx, state, "s")
    assert rec.status == "equalized"
    assert total_energy(ctx, new) == pytest.approx(total_energy(ctx, state), rel=1e-6)
    f = ctx.fluid
    s_before = f.at_DT(state.sources["s"].m / 0.6, T0).s
    s_after = f.at_DT(new.sources["s"].m / 0.6, new.sources["s"].T).s
    assert s_after == pytest.approx(s_before, abs=1e-6)
    assert pressure(ctx, new.sources["s"], 0.6) == pytest.approx(pressure(ctx, new.copv, 0.05), rel=1e-6)
    assert new.copv.T > T0 > new.sources["s"].T
    assert rec.exergy_destroyed > 0


def test_adiabatic_increment_convergence():
    ctx_coarse, state = make("Helium", "adiabatic", increments=60)
    ctx_fine, _ = make("Helium", "adiabatic", increments=2000)
    a, _ = connect(ctx_coarse, state, "s")
    b, _ = connect(ctx_fine, state, "s")
    assert a.copv.T == pytest.approx(b.copv.T, rel=2e-4)
    assert a.copv.m == pytest.approx(b.copv.m, rel=2e-4)


def test_ideal_gas_limit_filling_from_large_reservoir():
    # Near-empty tank fed from a huge reservoir at low pressure: T_final -> gamma * T_supply.
    ctx, state = make("Helium", "adiabatic", Vs=1000.0, Ps_barg=10.0 - P_ATM / 1e5, Pc_bara=0.001)
    new, _ = connect(ctx, state, "s")
    assert new.copv.T == pytest.approx(5 / 3 * T0, rel=0.01)


def test_wall_heat_capacity_lowers_temperature_and_conserves_energy():
    wall = 25.0 * 900.0
    ctx_a, state = make("Helium", "adiabatic")
    ctx_w, _ = make("Helium", "adiabatic_wall", wall_C=wall)
    hot, _ = connect(ctx_a, state, "s")
    warm, _ = connect(ctx_w, state, "s")
    assert T0 < warm.copv.T < hot.copv.T
    assert total_energy(ctx_w, warm, wall) == pytest.approx(total_energy(ctx_w, state, wall), rel=1e-6)


@pytest.mark.parametrize("mode", ["isothermal", "adiabatic"])
def test_stops_at_settled_target_mass(mode):
    ctx, state = make("Nitrogen", mode, Ps_barg=300.0, target_barg=180.0)
    new, rec = connect(ctx, state, "s")
    assert rec.status == "target_reached"
    assert new.copv.m == pytest.approx(ctx.m_target, rel=1e-9)
    again, rec2 = connect(ctx, new, "s")
    assert rec2.status == "not_needed" and again is new


def test_no_flow_when_source_below_copv():
    ctx, state = make("Nitrogen", "isothermal", Ps_barg=50.0, Pc_bara=101.0)
    new, rec = connect(ctx, state, "s")
    assert rec.status == "no_flow" and rec.dm == 0 and new is state


def test_cooldown_returns_to_ambient_at_constant_mass():
    ctx, state = make("Helium", "adiabatic")
    hot, _ = connect(ctx, state, "s")
    cool, rec = cooldown(ctx, hot)
    assert cool.copv.T == T0 and cool.sources["s"].T == T0
    assert cool.copv.m == hot.copv.m
    assert pressure(ctx, cool.copv, 0.05) < pressure(ctx, hot.copv, 0.05)
    assert rec.exergy_destroyed > 0 and math.isfinite(rec.exergy_destroyed)
