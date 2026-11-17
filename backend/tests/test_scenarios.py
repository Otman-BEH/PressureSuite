import pytest
from fastapi.testclient import TestClient

from pressuresuite.api.app import app
from pressuresuite.cascade_fill.models import CopvIn, OptimizeRequest, SequenceItem, Settings, SimulateRequest, SourceIn
from pressuresuite.cascade_fill.optimizer import optimize
from pressuresuite.cascade_fill.simulate import simulate


def bundle(sid, p, fluid="Nitrogen", count=12):
    return SourceIn(id=sid, kind="bundle", fluid=fluid, pressure_barg=p, cylinder_volume_l=50, cylinder_count=count)


def copv(fluid="Nitrogen", target=180.0):
    return CopvIn(fluid=fluid, volume_l=50, target_barg=target, initial_barg=0)


def seq(*items):
    return [SequenceItem(type="cooldown") if i == "cool" else SequenceItem(type="source", source_id=i) for i in items]


def run(sources, sequence, mode="isothermal", fluid="Nitrogen", target=180.0, temp=20.0):
    return simulate(SimulateRequest(settings=Settings(ambient_temp_c=temp, mode=mode), copv=copv(fluid, target),
                                    sources=sources, sequence=sequence))


def test_isothermal_cascade_reaches_settled_target():
    res = run([bundle("a", 150), bundle("c", 300)], seq("a", "c"))
    assert [s.status for s in res.steps] == ["equalized", "target_reached"]
    assert res.summary.target_reached
    assert res.summary.copv_settled.pressure_barg == pytest.approx(180.0, abs=1e-6)
    assert res.sources[0].end.pressure_barg == pytest.approx(138, abs=1)


def test_statuses_for_mismatch_no_flow_and_not_needed():
    sources = [bundle("he", 200, fluid="Helium"), bundle("bottle", 300, count=1), bundle("low", 100),
               bundle("x", 300), bundle("y", 300)]
    res = run(sources, seq("he", "bottle", "low", "x", "y"))
    assert [s.status for s in res.steps] == ["fluid_mismatch", "equalized", "no_flow", "target_reached", "not_needed"]
    assert res.warnings


def test_source_pressure_is_referenced_to_20c():
    res = run([bundle("a", 300)], [], temp=35.0)
    assert res.sources[0].start.pressure_barg > 310
    assert res.sources[0].pressure_ref_barg == pytest.approx(300, abs=1e-6)


def test_adiabatic_helium_needs_cooldowns():
    sources = [bundle("b1", 200, fluid="Helium")]
    one = run(sources, seq("b1"), mode="adiabatic", fluid="Helium", target=150)
    assert not one.summary.target_reached
    assert one.summary.peak_gas_temp_c > 150
    topped = run(sources, seq("b1", "cool", "b1", "cool", "b1"), mode="adiabatic", fluid="Helium", target=150)
    assert topped.summary.copv_settled.pressure_barg > one.summary.copv_settled.pressure_barg + 20


def opt(sources, mode="isothermal", fluid="Nitrogen", target=180.0, min_gain=10.0):
    return optimize(OptimizeRequest(settings=Settings(mode=mode), copv=copv(fluid, target), sources=sources,
                                    min_gain_bar=min_gain))


def ids(plan):
    return [i.source_id if i.type == "source" else "cool" for i in plan.sequence]


def test_optimizer_cascades_and_skips_tiny_gains():
    pool = [bundle("c300", 300), bundle("b160", 160), bundle("d162", 162), bundle("a150", 150)]
    res = opt(pool)
    assert res.feasible and res.search_complete
    # 160 and 162 would each add ~20 bar after the 150 bundle, but together the second adds ~3 bar:
    # one is skipped, and the 162 wins because it leaves less for the 300 bundle to top off.
    assert ids(res.best) == ["a150", "d162", "c300"]
    strict = opt(pool, min_gain=0)
    assert ids(strict.best) == ["a150", "b160", "d162", "c300"]
    plans = [tuple(ids(p)) for p in [res.best, *res.alternatives]]
    assert len(plans) == len(set(plans))


def test_optimizer_reports_unreachable_target():
    res = opt([bundle("a", 100)])
    assert not res.feasible
    assert "cannot be reached" in res.message
    assert res.best.summary.copv_settled.pressure_barg == pytest.approx(92, abs=2)


def test_optimizer_uses_cooldowns_in_adiabatic_mode():
    pool = [bundle("h1", 200, fluid="Helium"), bundle("h2", 200, fluid="Helium")]
    res = opt(pool, mode="adiabatic", fluid="Helium", target=150)
    assert res.feasible and res.best.summary.target_reached
    assert "cool" in ids(res.best)


def test_api_roundtrip():
    client = TestClient(app)
    meta = client.get("/api/cascade-fill/meta").json()
    assert {f["name"] for f in meta["fluids"]} == {"Nitrogen", "Helium"}
    body = {
        "settings": {"ambient_temp_c": 20, "mode": "adiabatic_wall"},
        "copv": {"fluid": "Nitrogen", "volume_l": 50, "target_barg": 180, "initial_barg": 0},
        "sources": [{"id": "a", "kind": "bundle", "fluid": "Nitrogen", "pressure_barg": 300,
                     "cylinder_volume_l": 50, "cylinder_count": 12}],
        "sequence": [{"type": "source", "source_id": "a"}],
    }
    r = client.post("/api/cascade-fill/simulate", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["target_reached"]
    body["sequence"] = [{"type": "source", "source_id": "nope"}]
    assert client.post("/api/cascade-fill/simulate", json=body).status_code == 422
