import math

import pytest
from fastapi.testclient import TestClient

from pressuresuite.config import P_ATM, barg_to_pa
from pressuresuite.cascade_fill.engine import FillContext, FillState, Timing, Vessel, connect, orifice_flow
from pressuresuite.api.app import app
from pressuresuite.cascade_fill.models import (
    AfterTestIn,
    CampaignRequest,
    CopvIn,
    HeatExchangerIn,
    SequenceItem,
    Settings,
    SimulateRequest,
    SourceIn,
    TimeModelIn,
)
from pressuresuite.cascade_fill.campaign import campaign
from pressuresuite.cascade_fill.simulate import simulate
from pressuresuite.thermo import get_fluid

T0 = 293.15


def bundle(sid, p, fluid="Nitrogen", count=12):
    return SourceIn(id=sid, kind="bundle", fluid=fluid, pressure_barg=p, cylinder_volume_l=50, cylinder_count=count)


def run(sources, sequence, *, mode="isothermal", fluid="Nitrogen", target=180.0, hx=None, after=None, time=None):
    return simulate(SimulateRequest(
        settings=Settings(mode=mode),
        copv=CopvIn(fluid=fluid, volume_l=50, target_barg=target, initial_barg=0),
        sources=sources, sequence=sequence,
        heat_exchanger=hx or HeatExchangerIn(), after_test=after or AfterTestIn(), time_model=time or TimeModelIn(),
    ))


def seq(*ids):
    return [SequenceItem(type="cooldown") if i == "cool" else SequenceItem(type="source", source_id=i) for i in ids]


# ---------------------------------------------------------------- vent

def test_isothermal_vent_counts_gas_lost():
    res = run([bundle("a", 300)], seq("a"), after=AfterTestIn(action="vent", vent_to_barg=0))
    s = res.summary
    assert res.steps[-1].type == "vent" and res.steps[-1].status == "vented"
    assert s.copv_after_test.pressure_barg == pytest.approx(0, abs=1e-6)
    assert s.vented_kg == pytest.approx(s.copv_end.mass_kg - s.copv_after_test.mass_kg, rel=1e-9)
    assert s.copv_settled.pressure_barg == pytest.approx(180, abs=1e-6)  # the test reading is before the vent


def test_adiabatic_helium_blowdown_gets_very_cold():
    res = run([bundle("a", 200, fluid="Helium")], seq("a", "cool", "a"), mode="adiabatic", fluid="Helium", target=150,
              after=AfterTestIn(action="vent", vent_to_barg=0))
    after = res.summary.copv_after_test
    assert after.pressure_barg == pytest.approx(0, abs=1e-3)
    assert after.temp_c < -150


# ---------------------------------------------------------------- heat exchanger

def test_heat_exchanger_cools_the_fill_and_balances_energy():
    hot = run([bundle("a", 200, fluid="Helium")], seq("a"), mode="adiabatic", fluid="Helium", target=150)
    hx = HeatExchangerIn(installed=True, control="outlet_temp", outlet_temp_c=0)
    cold = run([bundle("a", 200, fluid="Helium")], seq("a"), mode="adiabatic", fluid="Helium", target=150, hx=hx)
    # Pre-cooling helps but cannot remove the compression heating inside the COPV (~gamma * T_inlet from empty).
    assert cold.summary.peak_gas_temp_c < hot.summary.peak_gas_temp_c - 30
    assert cold.summary.peak_gas_temp_c + 273.15 == pytest.approx(5 / 3 * 273.15, rel=0.05)
    assert cold.steps[0].hx_outlet_min_c == pytest.approx(0, abs=1e-6)
    assert cold.summary.hx_duty_kwh > 0
    assert cold.summary.hx_chiller_kwh > 0  # outlet below ambient needs a chiller
    # Energy: what left the source = what the COPV gained + heat removed.
    f = get_fluid("Helium")
    s0, s1 = cold.sources[0].start, cold.sources[0].end
    c0, c1 = cold.steps[0].copv_before, cold.steps[0].copv_after
    u = lambda v, V: v.mass_kg * f.at_DT(v.mass_kg / V, v.temp_c + 273.15).u  # noqa: E731
    lost = u(s0, 0.6) - u(s1, 0.6)
    gained = u(c1, 0.05) - u(c0, 0.05)
    assert lost == pytest.approx(gained + cold.summary.hx_duty_kwh * 3.6e6, rel=1e-4)


def test_heat_exchanger_effectiveness_and_isothermal_noop():
    hx = HeatExchangerIn(installed=True, control="effectiveness", coolant_temp_c=20, effectiveness_pct=50)
    res = run([bundle("a", 200, fluid="Helium")], seq("a"), mode="adiabatic", fluid="Helium", target=150, hx=hx)
    st = res.steps[0]
    assert 20 < st.hx_outlet_max_c < 60
    assert res.summary.hx_chiller_kwh == 0  # coolant at ambient: no chiller
    iso = run([bundle("a", 300)], seq("a"), hx=hx)
    assert iso.summary.hx_duty_kwh == 0 and iso.steps[0].hx_outlet_max_c is None


def test_heat_exchanger_preview():
    client = TestClient(app)
    r = client.post("/api/cascade-fill/heat-exchanger/preview", json={
        "fluid": "Nitrogen", "exchanger": {"control": "effectiveness", "coolant_temp_c": 10, "effectiveness_pct": 80},
        "inlet_temp_c": 110, "pressure_barg": 200})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outlet_temp_c"] == pytest.approx(110 - 0.8 * 100, abs=1e-3)  # warm-gas flashes use the tables
    assert body["duty_kj_per_kg"] > 0 and body["chiller_kj_per_kg"] > 0


# ---------------------------------------------------------------- time model

def test_orifice_flow_choked_and_subsonic():
    choked = orifice_flow(1e-6, 1e7, 100.0, 1.4, 1e5)
    assert choked == pytest.approx(1e-6 * math.sqrt(1.4 * 100 * 1e7 * (2 / 2.4) ** (2.4 / 0.4)), rel=1e-12)
    assert orifice_flow(1e-6, 1e7, 100.0, 1.4, 0.9e7) < choked
    assert orifice_flow(1e-6, 1e7, 100.0, 1.4, 1e7) == 0


def test_choked_fill_from_a_huge_reservoir_takes_mass_over_flow():
    # The reservoir barely changes and the COPV stays below the critical ratio, so the flow is constant.
    f = get_fluid("Nitrogen")
    Vs, Vc, area = 1000.0, 0.05, 1e-6
    target = f.rho_PT(barg_to_pa(80), T0) * Vc
    ctx = FillContext(f, "isothermal", T0, Vc, target, 0.0, {"s": Vs}, timing=Timing(area, 0.0))
    state = FillState(Vessel(f.rho_PT(P_ATM, T0) * Vc, T0), {"s": Vessel(f.rho_PT(barg_to_pa(200), T0) * Vs, T0)})
    _, rec = connect(ctx, state, "s")
    src = f.at_PT(barg_to_pa(200), T0)
    mdot = orifice_flow(area, src.P, src.rho, src.cp / src.cv, P_ATM)
    assert rec.duration == pytest.approx(rec.dm / mdot, rel=2e-3)


@pytest.mark.parametrize("mode", ["isothermal", "adiabatic"])
def test_time_model_durations(mode):
    small = run([bundle("a", 150), bundle("b", 300)], seq("a", "b"), mode=mode, time=TimeModelIn(enabled=True, orifice_mm=1))
    big = run([bundle("a", 150), bundle("b", 300)], seq("a", "b"), mode=mode, time=TimeModelIn(enabled=True, orifice_mm=4))
    t_small = sum(s.duration_min for s in small.steps)
    t_big = sum(s.duration_min for s in big.steps)
    assert t_small == pytest.approx(16 * t_big, rel=0.02)  # flow scales with area
    limited = run([bundle("a", 150), bundle("b", 300)], seq("a", "b"), mode=mode,
                  time=TimeModelIn(enabled=True, orifice_mm=4, max_rate_bar_min=5))
    assert sum(s.duration_min for s in limited.steps) >= limited.summary.peak_pressure_barg / 5 - 1e-6
    tb = limited.summary.time
    assert tb.total_min == pytest.approx(tb.handling_min + tb.fill_min + tb.settle_min + tb.hold_min + tb.after_test_min)
    assert tb.handling_min == pytest.approx(2 * 3)
    assert (tb.settle_min > 0) == (mode == "adiabatic")
    off = run([bundle("a", 150), bundle("b", 300)], seq("a", "b"), mode=mode)
    assert off.summary.time is None and all(s.duration_min is None for s in off.steps)


def test_cooldown_duration_and_campaign_total():
    res = run([bundle("a", 200, fluid="Helium")], seq("a", "cool", "a"), mode="adiabatic_wall", fluid="Helium",
              target=150, time=TimeModelIn(enabled=True))
    cool = res.steps[1]
    assert cool.type == "cooldown" and cool.duration_min > 10
    c = campaign(CampaignRequest(settings=Settings(), copv=CopvIn(fluid="Nitrogen", volume_l=50, target_barg=180,
                                                                  initial_barg=0),
                                 sources=[bundle("a", 300)], count=2, time_model=TimeModelIn(enabled=True)))
    assert c.completed == 2
    assert c.total_time_min == pytest.approx(sum(f.summary.time.total_min for f in c.fills))
