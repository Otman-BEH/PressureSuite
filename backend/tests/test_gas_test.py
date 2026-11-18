"""Gas test cycles, gas used and supply bundles."""

import math

import pytest
from fastapi.testclient import TestClient

from pressuresuite.api.app import app
from pressuresuite.gas_test import GasTestRequest, gas_test
from pressuresuite.stored_energy import StoredEnergyRequest, stored_energy
from pressuresuite.thermo import Fluid

client = TestClient(app)
CYCLE = {"target_barg": 250, "hold_min": 10, "vent_barg": 100, "vent_hold_min": 5}
EXACT_N2 = Fluid("Nitrogen", tabular="")


def rho(p_bara):
    return EXACT_N2.rho_PT(p_bara * 1e5, 293.15)


def run(**kw):
    kw.setdefault("volume_l", 50)
    kw.setdefault("cycles", [CYCLE] * 3)
    return gas_test(GasTestRequest(**kw))


def test_gas_used_by_hand():
    # Rigid 50 L: each fill is V * (rho(target) - rho(start)), each vent V * (rho(end of hold) - rho(vent)).
    r = run()
    c1, c2, _ = r.cycles
    assert c1.filled_kg == pytest.approx(0.05 * (rho(251) - rho(1)), rel=1e-6)
    assert c2.filled_kg == pytest.approx(0.05 * (rho(251) - rho(101)), rel=1e-6)
    assert c1.vented_kg == pytest.approx(0.05 * (rho(251) - rho(101)), rel=1e-6)
    # Gas used = vented + left in the vessel at the end (no leak).
    assert r.totals.used_kg == pytest.approx(r.totals.vented_kg + r.totals.left_in_vessel_kg, rel=1e-9)
    assert r.totals.used_nm3 == pytest.approx(r.totals.used_kg / 1.2504, rel=1e-3)


def test_supply_bundles_nitrogen_300_bar():
    r = run()
    s = r.supply
    assert s.bundle_pressure_barg == 300 and s.bundle_volume_l == 600
    assert s.decant_usable_kg == pytest.approx(0.6 * (rho(301) - rho(251)), rel=1e-6)
    assert s.bundles_decant == math.ceil(r.totals.used_kg / s.decant_usable_kg)
    assert s.booster_usable_kg == pytest.approx(0.6 * (rho(301) - rho(21)), rel=1e-6)
    assert s.bundles_booster == math.ceil(r.totals.used_kg / s.booster_usable_kg)


def test_helium_uses_200_bar_bundles():
    r = run(fluid="Helium")
    assert r.supply.bundle_pressure_barg == 200
    assert r.supply.decant_usable_kg is None and r.supply.bundles_decant is None  # 250 barg target > 200 barg bundles
    assert any("booster is needed" in n.text for n in r.notes)
    assert r.notes[0].level == "critical" and "Pneumatic test" in r.notes[0].text
    assert run(fluid="Helium", cycles=[{"target_barg": 150}]).supply.bundles_decant >= 1


def test_peak_energy_matches_stored_energy_tool():
    r = run(cycles=[{"target_barg": 250}])
    se = stored_energy(StoredEnergyRequest(fluid="Nitrogen", volume_l=50, pressure_barg=250))
    assert r.cycles[0].energy_kj == pytest.approx(se.energy_kj, rel=1e-9)


def test_leak_rate_from_measured_hold():
    # 250 -> 249.4 barg over 60 min = 0.01 bar/min; gas lost = V (rho(251 bar a) - rho(250.4 bar a)).
    r = run(cycles=[{"target_barg": 250, "hold_min": 60, "measured_end_hold_barg": 249.4}])
    c = r.cycles[0]
    assert c.leak_rate_bar_min == pytest.approx(0.01)
    assert c.leaked_kg == pytest.approx(0.05 * (rho(251) - rho(250.4)), rel=1e-6)
    assert r.totals.test_pressure_barg == 250


def test_api_validation():
    res = client.post("/api/gas-test/calculate", json={"fluid": "Nitrogen", "volume_l": 50, "cycles": [
        {"target_barg": 100, "vent_barg": 150}]})
    assert res.status_code == 422 and "must be below the target" in res.json()["detail"]
    res = client.post("/api/gas-test/calculate", json={"fluid": "Water", "volume_l": 50, "cycles": [{"target_barg": 100}]})
    assert res.status_code == 422
    assert client.get("/api/gas-test/meta").json()["bundle_pressure_barg"] == {"Nitrogen": 300.0, "Helium": 200.0}


def test_repeat_matches_writing_the_cycles_out():
    # 50 repeats of a two-cycle list = the same 100 cycles listed one by one.
    pair = [CYCLE, {"target_barg": 200, "hold_min": 5}]
    short = run(cycles=pair, repeat=50)
    long = run(cycles=pair * 50)
    assert short.totals.cycle_count == 100 and len(short.cycles) == 2
    for f in ("used_kg", "vented_kg", "duration_min", "left_in_vessel_kg"):
        assert getattr(short.totals, f) == pytest.approx(getattr(long.totals, f), rel=1e-9), f
    assert short.supply.bundles_booster == long.supply.bundles_booster


def test_repeat_needs_the_first_target_above_the_last_vent():
    res = client.post("/api/gas-test/calculate", json={"volume_l": 50, "repeat": 10, "cycles": [
        {"target_barg": 100}, {"target_barg": 250, "vent_barg": 150}]})
    assert res.status_code == 422 and "To repeat the cycles" in res.json()["detail"]
