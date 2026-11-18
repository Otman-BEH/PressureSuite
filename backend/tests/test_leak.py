"""Leak rate from a measured hold: bar/min, mass lost and equivalent flow."""

import pytest
from fastapi.testclient import TestClient

from pressuresuite.api.app import app
from pressuresuite.leak import LeakRequest, leak
from pressuresuite.leak.physics import per_unit_kg_s
from pressuresuite.test_cycles import leak_rate_bar_min

client = TestClient(app)
T20 = 293.15


def test_rate_is_drop_over_time():
    assert leak_rate_bar_min(300e5, 298.8e5, 5) == pytest.approx(0.24)
    with pytest.raises(ValueError):
        leak_rate_bar_min(300e5, 299e5, 0)


def test_unit_conversions_by_hand():
    # 1 mL/min of water at 20 °C: 998.2 kg/m3 * 1e-6 m3 / 60 s
    assert per_unit_kg_s("Water", T20, "ml_min") == pytest.approx(998.2e-6 / 60, rel=1e-4)
    # 1 sccm of N2: rho(0 °C, 1 atm) = 1.2504 kg/m3, times 1 cm3/min
    assert per_unit_kg_s("Nitrogen", T20, "sccm") == pytest.approx(1.2504e-6 / 60, rel=1e-3)
    # 1 mbar·L/s of N2 at 20 °C: 0.1 Pa·m3/s / (296.8 J/kgK * 293.15 K)
    assert per_unit_kg_s("Nitrogen", T20, "mbar_l_s") == pytest.approx(0.1 / (296.8 * 293.15), rel=1e-3)


def test_water_hold_by_hand():
    # Rigid 100 L of water, 300 -> 298.8 barg in 5 min: 0.24 bar/min.
    # Lost, hand: V dp / K = 0.1 * 1.2e5 / 2.35e9 = 5.1 mL -> about 1 mL/min.
    r = leak(LeakRequest(fluid="Water", volume_l=100, start_barg=300, end_barg=298.8, hold_min=5))
    assert r.phase == "liquid"
    assert r.rate_bar_min == pytest.approx(0.24)
    assert r.drop_bar == pytest.approx(1.2)
    assert r.lost_kg == pytest.approx(5.1e-3, rel=0.03)
    assert [f.unit for f in r.flows] == ["mL/min"]
    assert r.flows[0].value == pytest.approx(1.02, rel=0.03)


def test_gas_hold_gives_gas_units():
    r = leak(LeakRequest(fluid="Nitrogen", volume_l=50, start_barg=250, end_barg=249.4, hold_min=60))
    assert r.phase == "gas"
    assert r.rate_bar_min == pytest.approx(0.01)
    assert [f.unit for f in r.flows] == ["sccm", "NL/min", "mbar·L/s"]
    sccm, nl, _ = (f.value for f in r.flows)
    assert sccm == pytest.approx(nl * 1000, rel=1e-9)


@pytest.mark.parametrize("body, fragment", [
    ({"fluid": "Water", "volume_l": 100, "start_barg": 300, "end_barg": 301, "hold_min": 5}, "warmed"),
    ({"fluid": "Water", "volume_l": 100, "start_barg": 300, "end_barg": 299, "hold_min": 0}, "hold_min"),
    ({"fluid": "Water", "volume_l": -1, "start_barg": 300, "end_barg": 299, "hold_min": 5}, "volume_l"),
])
def test_invalid_inputs_return_clear_errors(body, fragment):
    res = client.post("/api/leak/calculate", json=body)
    assert res.status_code == 422
    assert fragment in str(res.json()["detail"])
