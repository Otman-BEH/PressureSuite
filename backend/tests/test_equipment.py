import pytest
from fastapi.testclient import TestClient

from pressuresuite.config import barg_to_pa
from pressuresuite.cascade_fill.engine import FillContext, FillState, Machine, Vessel, compress, pump, recover
from pressuresuite.api.app import app
from pressuresuite.cascade_fill.models import (
    CampaignRequest,
    CopvIn,
    EquipmentIn,
    MachineIn,
    AfterTestIn,
    SequenceItem,
    Settings,
    SimulateRequest,
    SourceIn,
    default_booster,
)
from pressuresuite.cascade_fill.campaign import campaign
from pressuresuite.cascade_fill.simulate import simulate, to_machine
from pressuresuite.thermo import get_fluid

T0 = 293.15


def bundle(sid, p, fluid="Nitrogen", count=12):
    return SourceIn(id=sid, kind="bundle", fluid=fluid, pressure_barg=p, cylinder_volume_l=50, cylinder_count=count)


def run(sources, sequence, *, mode="isothermal", fluid="Nitrogen", target=180.0, leak=0.0, equipment=None, after_test=None):
    return simulate(SimulateRequest(
        settings=Settings(mode=mode),
        copv=CopvIn(fluid=fluid, volume_l=50, target_barg=target, initial_barg=0, leak_pct=leak),
        sources=sources, sequence=sequence,
        equipment=equipment or EquipmentIn(), after_test=after_test or AfterTestIn(),
    ))


def item(kind, sid=None, machine=None):
    return SequenceItem(type=kind, source_id=sid, machine=machine)


@pytest.mark.parametrize("mode", ["isothermal", "adiabatic"])
def test_leak_costs_one_plus_x_of_the_gas(mode):
    res = run([bundle("a", 150), bundle("b", 300)], [item("source", "a"), item("source", "b")], mode=mode, leak=5)
    s = res.summary
    used = sum(r.used_kg for r in res.sources)
    assert s.target_reached
    assert used == pytest.approx(1.05 * s.delivered_kg, rel=1e-6)
    assert s.leaked_kg == pytest.approx(0.05 * s.delivered_kg, rel=1e-6)


def test_booster_drains_a_bundle_below_copv_pressure():
    sources = [bundle("low", 150)]
    valve = run(sources, [item("source", "low")])
    boosted = run(sources, [item("source", "low"), item("pump", "low", "booster")])
    assert not valve.summary.target_reached
    assert boosted.summary.target_reached
    step = boosted.steps[1]
    assert step.status == "target_reached" and step.energy_kwh > 0
    assert step.duration_min is None  # pump times only with the time estimate on
    assert step.outlet_temp_max_c > 20


def test_booster_stops_at_min_inlet():
    res = run([bundle("bottle", 100, count=1)], [item("pump", "bottle", "booster")], target=300)
    step = res.steps[0]
    assert step.status == "inlet_limit"
    assert step.source_after.pressure_barg == pytest.approx(default_booster().inlet_min_barg, abs=1e-3)


def test_booster_stops_at_max_outlet_and_ratio():
    low_outlet = EquipmentIn(booster=default_booster().model_copy(update={"outlet_max_barg": 190}))
    res = run([bundle("a", 300)], [item("pump", "a", "booster")], target=250, equipment=low_outlet)
    assert res.steps[0].status == "outlet_limit"
    assert res.steps[0].copv_after.pressure_barg == pytest.approx(190, abs=1e-3)

    tight = EquipmentIn(booster=default_booster().model_copy(update={"max_ratio": 2, "inlet_min_barg": 0}))
    res = run([bundle("b", 100, count=1)], [item("source", "b"), item("pump", "b", "booster")], target=300, equipment=tight)
    st = res.steps[1]
    assert st.status == "ratio_limit"
    p_in, p_out = barg_to_pa(st.source_after.pressure_barg), barg_to_pa(st.copv_after.pressure_barg)
    assert p_out / p_in == pytest.approx(2, rel=1e-4)


def test_pump_not_started_below_min_inlet():
    res = run([bundle("a", 10)], [item("pump", "a", "booster")])
    assert res.steps[0].status == "no_flow"
    assert "minimum inlet" in res.steps[0].message


def test_adiabatic_pump_energy_balance():
    f = get_fluid("Helium")
    mc = Machine(barg_to_pa(0), barg_to_pa(300), barg_to_pa(400), 50, 1, 0.75, False)
    Vs, Vc = 0.6, 0.05
    ctx = FillContext(f, "adiabatic", T0, Vc, f.rho_PT(barg_to_pa(150), T0) * Vc, 0.0, {"s": Vs})
    state = FillState(Vessel(f.rho_PT(1e5, T0) * Vc, T0), {"s": Vessel(f.rho_PT(barg_to_pa(100), T0) * Vs, T0)})

    def energy(st):
        c, s = st.copv, st.sources["s"]
        return c.m * f.at_DT(c.m / Vc, c.T).u + s.m * f.at_DT(s.m / Vs, s.T).u

    new, rec = pump(ctx, state, "s", mc)
    assert rec.status == "target_reached"
    assert energy(new) == pytest.approx(energy(state) + rec.work, rel=1e-5)


def test_single_stage_compression_ideal_gas_limit():
    f = get_fluid("Helium")
    mc = Machine(1e5, 1e6, 1e7, 100, 1, 1.0, False)
    feed = f.at_PT(2e5, T0)
    _, w, T_out, _ = compress(f, T0, mc, feed, 8e5)
    assert T_out == pytest.approx(T0 * 4 ** 0.4, rel=0.005)
    assert w == pytest.approx(5193 * (T_out - T0), rel=0.01)  # cp of helium


def test_recovery_returns_gas_to_a_bundle():
    sources = [bundle("a", 300), bundle("rec", 0)]
    res = run(sources, [item("source", "a")], after_test=AfterTestIn(action="recover", vessel_id="rec"))
    s = res.summary
    assert s.target_reached and s.copv_settled.pressure_barg == pytest.approx(180, abs=1e-6)
    rec_steps = [st for st in res.steps if st.type == "recovery"]
    assert [st.machine for st in rec_steps] == [None, "compressor"]
    assert s.copv_after_test.pressure_barg == pytest.approx(0, abs=1e-3)  # compressor inlet minimum
    rec_bundle = next(r for r in res.sources if r.id == "rec")
    assert -rec_bundle.used_kg == pytest.approx(s.recovered_kg, rel=1e-6)
    assert s.recovered_kg == pytest.approx(s.delivered_kg + res.steps[0].copv_before.mass_kg - s.copv_after_test.mass_kg, rel=1e-6)
    assert s.recovery_energy_kwh > 0


def test_campaign_counts_fills_until_gas_runs_out():
    def req(sources, count, leak=0.0):
        copv = CopvIn(fluid="Nitrogen", volume_l=50, target_barg=180, initial_barg=0, leak_pct=leak)
        return CampaignRequest(settings=Settings(), copv=copv, sources=sources, count=count)

    plenty = campaign(req([bundle("a", 300), bundle("b", 300)], 3))
    assert plenty.completed == 3 and all(f.feasible for f in plenty.fills)
    scarce = campaign(req([bundle("a", 250)], 20))
    assert 0 < scarce.completed < 20
    assert not scarce.fills[-1].feasible and "runs out" in scarce.message
    leaky = campaign(req([bundle("a", 250)], 20, leak=20))
    assert leaky.completed <= scarce.completed


def test_api_campaign_and_machine_preview():
    client = TestClient(app)
    r = client.post("/api/cascade-fill/machine/preview", json={
        "fluid": "Nitrogen", "machine": default_booster().model_dump(), "inlet_barg": 150, "outlet_barg": 300})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["runs"] and body["outlet_temp_c"] > 20 and body["ratio"] == pytest.approx(301.0 / 151.0, rel=1e-3)
    bad = client.post("/api/cascade-fill/machine/preview", json={
        "fluid": "Nitrogen", "machine": default_booster().model_dump(), "inlet_barg": 5, "outlet_barg": 300})
    assert not bad.json()["runs"]
    r = client.post("/api/cascade-fill/campaign", json={
        "settings": {"mode": "isothermal"},
        "copv": {"fluid": "Nitrogen", "volume_l": 50, "target_barg": 180, "initial_barg": 0},
        "sources": [bundle("a", 300).model_dump()], "count": 2})
    assert r.status_code == 200, r.text
    assert r.json()["completed"] == 2
