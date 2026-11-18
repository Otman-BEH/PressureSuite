"""Hydrostatic test cycles against hand calculations."""

import pytest
from fastapi.testclient import TestClient

from pressuresuite.api.app import app
from pressuresuite.hydro_test import HydroTestRequest, hydro_test
from pressuresuite.hydro_test.calculate import volume_check
from pressuresuite.hydro_test.models import VolumeCheckRequest
from pressuresuite.hydro_test.physics import gas_pocket_volume, pumped_with_gas_pocket, transfer
from pressuresuite.test_cycles import CycleSpec, run_cycles
from pressuresuite.vessel import Tank
from pressuresuite.stored_energy import StoredEnergyRequest, stored_energy
from pressuresuite.stored_energy.physics import Wall

T20 = 293.15
WALL = {"shape": "cylinder", "inner_diameter_mm": 300, "thickness_mm": 8, "youngs_modulus_gpa": 200, "poisson": 0.3}
client = TestClient(app)


THREE_AT_300 = [{"target_barg": 300}] * 3


def run(**kw):
    kw.setdefault("volume_l", 100)
    kw.setdefault("cycles", THREE_AT_300)
    return hydro_test(HydroTestRequest(**kw))


def test_compressibility_volume_by_hand():
    # Hand: dV = V p / K = 100 L * 300e5 / 2.24e9 = 1.34 L (K of water at 20 °C, mid-range)
    t = transfer("Water", Tank(V0=0.1), T20, 0.0, 300e5)
    assert t.volume_m3 * 1e3 == pytest.approx(1.34, rel=0.02)
    assert t.tank_m3 == 0.0


def test_tank_expansion_by_hand():
    # Hand: thin cylinder dV/V = p D (5 - 4 nu) / (4 t E) = 300e5 * 0.3 * 3.8 / (4 * 0.008 * 200e9) = 5.34e-3 -> 0.534 L
    wall = Wall("cylinder", D=0.3, t=0.008, E=200e9, nu=0.3)
    t = transfer("Water", Tank(V0=0.1, wall=wall), T20, 0.0, 300e5)
    assert t.tank_m3 * 1e3 == pytest.approx(0.534, rel=0.02)
    assert t.volume_m3 == pytest.approx(t.compressibility_m3 + t.tank_m3, rel=1e-12)


def test_three_cycles_at_300_bar():
    r = run(wall=WALL)
    assert len(r.cycles) == 3
    for c in r.cycles:
        assert c.target_barg == pytest.approx(300.0)
        assert c.returned_l == pytest.approx(c.pumped_l, rel=1e-12)  # elastic, vented to 0
        assert c.pumped_l == pytest.approx(c.pumped_compressibility_l + c.pumped_tank_l, rel=1e-12)
    assert r.totals.pumped_l == pytest.approx(3 * r.cycles[0].pumped_l)
    assert r.totals.retained_l == pytest.approx(0.0, abs=1e-12)


def test_partial_vent_between_cycles():
    r = run(cycles=[
        {"target_barg": 250, "hold_min": 10, "vent_barg": 50},
        {"target_barg": 280, "hold_min": 5, "vent_barg": 0},
    ])
    c1, c2 = r.cycles
    assert (c1.start_barg, c1.target_barg, c1.vent_barg) == (0, 250, 50)
    assert c2.start_barg == 50  # starts where the previous cycle vented to
    assert c1.returned_l < c1.pumped_l
    # Everything pumped in comes back by the end, because the last cycle vents to 0.
    assert r.totals.retained_l == pytest.approx(0.0, abs=1e-9)


def test_peak_energy_reuses_the_stored_energy_calculation():
    r = run(wall=WALL)
    se = stored_energy(StoredEnergyRequest(fluid="Water", volume_l=100, pressure_barg=300, wall=WALL))
    assert r.cycles[0].energy_kj == pytest.approx(se.energy_kj, rel=1e-12)
    assert r.cycles[0].energy_wall_kj == pytest.approx(se.liquid.wall_kj, rel=1e-12)


def test_timeline_and_durations():
    # 0 -> 300 bar at 10 bar/min = 30 min, hold 5 min, vent 300 -> 0 at 20 bar/min = 15 min.
    r = run(cycles=[{"target_barg": 300, "hold_min": 5}], pressurisation_bar_min=10, vent_bar_min=20)
    assert [(p.t_min, p.pressure_barg) for p in r.timeline] == [(0, 0), (30, 300), (35, 300), (50, 0)]
    assert r.cycles[0].duration_min == pytest.approx(50)
    assert r.totals.duration_min == pytest.approx(50)
    _, pts = run_cycles("Water", Tank(0.01), T20, [CycleSpec(100e5, 0.0, 20e5), CycleSpec(100e5, 1.0, 0.0)], 10e5, 10e5)
    assert [p.t_min for p in pts] == pytest.approx([0, 10, 18, 26, 27, 37])


def test_hold_at_the_vent_down_pressure():
    # Vent to 100 barg and hold there 5 min; the next cycle starts from 100 barg.
    r = run(cycles=[{"target_barg": 300, "hold_min": 5, "vent_barg": 100, "vent_hold_min": 5}, {"target_barg": 300}],
            pressurisation_bar_min=10, vent_bar_min=20)
    c1, c2 = r.cycles
    assert c1.vent_hold_min == 5 and c1.vent_barg == pytest.approx(100)
    assert c2.start_barg == pytest.approx(100)
    # 30 min up, 5 hold, 10 down to 100, 5 hold at 100 = 50 min.
    assert c1.duration_min == pytest.approx(50)
    assert [(p.t_min, p.pressure_barg, p.phase) for p in r.timeline[:5]] == [
        (0, 0, "Start"), (30, 300, "Pressurisation"), (35, 300, "Hold"), (45, 100, "Vent"), (50, 100, "Hold at vent")]
    assert c2.pumped_l < c1.pumped_l  # from 100 barg needs less water than from 0
    assert r.totals.test_pressure_barg == 300


def test_leak_rate_from_measured_end_of_hold():
    # Measured 298.8 barg after a 5 min hold at 300 barg: (300 - 298.8) / 5 = 0.24 bar/min.
    # Water lost, hand: V dp / K = 100 L * 1.2e5 / 2.35e9 = 5.1 mL.
    r = run(cycles=[{"target_barg": 300, "hold_min": 5, "vent_barg": 100, "measured_end_hold_barg": 298.8},
                    {"target_barg": 300, "hold_min": 5}], pressurisation_bar_min=10, vent_bar_min=20)
    c1, c2 = r.cycles
    assert c1.leak_rate_bar_min == pytest.approx(0.24)
    assert c1.hold_drop_bar == pytest.approx(1.2)
    assert c1.leaked_l == pytest.approx(5.1e-3, rel=0.03)
    assert c2.leak_rate_bar_min is None
    # The chart follows the measured drop, then vents from it: 298.8 -> 100 at 20 bar/min = 9.94 min.
    pts = [(p.t_min, p.pressure_barg, p.phase) for p in r.timeline[1:4]]
    assert pts == [(30, 300, "Pressurisation"), (35, pytest.approx(298.8), "Hold (measured)"),
                   (pytest.approx(35 + 198.8 / 20), 100, "Vent")]
    # Everything put in came back or leaked (the tank ends at 0 barg).
    assert r.totals.pumped_l == pytest.approx(r.totals.returned_l + r.totals.leaked_l, rel=1e-9)


def test_measured_pressure_above_target_is_rejected():
    res = client.post("/api/hydro-test/calculate", json={"volume_l": 100, "cycles": [
        {"target_barg": 300, "hold_min": 5, "measured_end_hold_barg": 301}]})
    assert res.status_code == 422 and "warming" in res.json()["detail"]


# ------------------------------------------------------------------------------------------------ volume check


def check(mode="tank", runs=(), **kw):
    return volume_check(VolumeCheckRequest(mode=mode, runs=list(runs), **kw))


def test_tank_volume_from_water_pumped_in():
    pumped = transfer("Water", Tank(0.1), T20, 0.0, 300e5).volume_m3 * 1e3
    r = check(runs=[{"to_barg": 300, "pumped_l": pumped, "returned_l": pumped}])
    assert r.mean_l == pytest.approx(100.0, rel=1e-9)
    assert r.runs[0].difference_pct == pytest.approx(0.0, abs=1e-9)
    # With the wall stretching, the same pumped volume means a smaller tank.
    assert check(runs=[{"to_barg": 300, "pumped_l": pumped}], wall=WALL).mean_l < 80


def test_repeated_runs_are_averaged():
    # Three presses to 300 barg and one to 150 barg; every value counts once in the mean.
    p300 = transfer("Water", Tank(0.1), T20, 0.0, 300e5).volume_m3 * 1e3
    p150 = transfer("Water", Tank(0.1), T20, 0.0, 150e5).volume_m3 * 1e3
    r = check(runs=[{"to_barg": 300, "pumped_l": p300 * 1.01, "returned_l": p300 * 0.99},
                    {"to_barg": 300, "pumped_l": p300},
                    {"to_barg": 150, "pumped_l": p150}])
    assert r.count == 4
    assert r.mean_l == pytest.approx(100.0, rel=1e-3)  # 101 + 99 + 100 + 100, over 4
    assert r.spread_pct == pytest.approx(2.0, rel=1e-3)  # (101 - 99) / 100


def test_gas_pocket_by_boyle():
    # Hand: rigid 100 L tank with 1 L of air at 0 barg (1 bar a), pressed to 9 barg (10 bar a):
    #   the air shrinks to 0.1 L (Boyle) -> 0.9 L, plus the water compresses 99 L * 9e5 / 2.2e9 = 0.040 L -> 0.94 L in.
    tank = Tank(0.1)
    m = pumped_with_gas_pocket("Water", tank, T20, 0.0, 9e5, 1e-3)
    assert m / 998.2 * 1e3 == pytest.approx(0.94, rel=0.01)
    assert gas_pocket_volume("Water", tank, T20, 0.0, 9e5, m) == pytest.approx(1e-3, rel=1e-9)
    r = check("gas_pocket", [{"to_barg": 9, "pumped_l": 0.94}], volume_l=100)
    assert r.mean_l == pytest.approx(1.0, rel=0.01)
    assert r.runs[0].expected_pumped_l == pytest.approx(0.041, rel=0.03)
    # The same pocket measured from 5 barg is reported at 1 bar a, so runs from different pressures average correctly.
    m5 = pumped_with_gas_pocket("Water", tank, T20, 5e5, 9e5, 1e-3 / 6)  # 1 L at 1 bar a is ~1/6 L at 6 bar a
    r2 = check("gas_pocket", [{"to_barg": 9, "pumped_l": 0.94},
                              {"from_barg": 5, "to_barg": 9, "pumped_l": m5 / 998.2 * 1e3}], volume_l=100)
    assert r2.runs[1].from_press_l == pytest.approx(1.0, rel=0.01)


def test_trapped_air_energy_is_critical():
    # Hand, 1 L of air (at 1 bar a) in a rigid 100 L tank pressed to 9 barg (10 bar a):
    #   water p^2 V / 2K = (9e5)^2 * 0.1 / (2 * 2.2e9) = 18 J
    #   air, isentropic from 10 bar a / 0.1 L to 1 bar a: p V / (g - 1) (1 - 0.1^0.286) = 1e6 * 1e-4 / 0.4 * 0.48 = 120 J,
    #   less pushing back the atmosphere, 1e5 * (0.518 - 0.1) L = 42 J -> 78 J (same basis as the Stored Energy tool)
    r = check("gas_pocket", [{"to_barg": 9, "pumped_l": 0.94}], volume_l=100)
    assert r.liquid_energy_kj == pytest.approx(0.018, rel=0.05)
    assert r.pocket_energy_kj == pytest.approx(0.078, rel=0.03)
    assert any(n.level == "critical" and "Trapped gas" in n.text for n in r.notes)
    # At 300 barg the water dominates (~19 kJ vs ~0.14 kJ for the same pocket): no critical note.
    pumped = pumped_with_gas_pocket("Water", Tank(0.1), T20, 0.0, 300e5, 1e-3) / 998.2 * 1e3
    r = check("gas_pocket", [{"to_barg": 300, "pumped_l": pumped}], volume_l=100)
    assert r.mean_l == pytest.approx(1.0, rel=0.01)
    assert r.pocket_energy_kj < r.liquid_energy_kj
    assert not any(n.level == "critical" for n in r.notes)


def test_press_depress_mismatch_is_flagged():
    r = check("gas_pocket", [{"to_barg": 9, "pumped_l": 0.94, "returned_l": 0.80}], volume_l=100)
    assert r.runs[0].difference_pct > 2
    assert any("disagree" in n.text and n.level == "note" for n in r.notes)
    with pytest.raises(ValueError, match="tank volume"):
        check("gas_pocket", [{"to_barg": 9, "pumped_l": 0.94}])


ONE = [{"target_barg": 100}]


@pytest.mark.parametrize("body, fragment", [
    ({"volume_l": 0, "cycles": ONE}, "volume_l"),
    ({"volume_l": 10, "cycles": [{"target_barg": 100, "vent_barg": 150}]}, "must be below the target"),
    ({"volume_l": 10, "cycles": [{"target_barg": 100, "vent_barg": 80}, {"target_barg": 50}]},
     "below the pressure the previous cycle vented to"),
    ({"volume_l": 10, "temp_c": 150, "cycles": ONE}, "not a liquid"),
    ({"volume_l": 10, "cycles": [{"target_barg": 20000}]}, "less than or equal"),
    ({"volume_l": 10, "cycles": [{"target_barg": 9999}], "fluid": "Ethanol"}, "limit"),
    ({"volume_l": 10, "cycles": []}, "cycles"),
    ({"volume_l": 10, "cycles": [{"hold_min": 5}]}, "target_barg"),
])
def test_invalid_inputs_return_clear_errors(body, fragment):
    res = client.post("/api/hydro-test/calculate", json=body)
    assert res.status_code == 422
    assert fragment in str(res.json()["detail"])


def test_repeat_matches_writing_the_cycles_out():
    cyc = [{"target_barg": 300, "hold_min": 5, "vent_barg": 100, "vent_hold_min": 2}]
    short = run(cycles=cyc, repeat=20)
    long = run(cycles=cyc * 20)
    assert short.totals.cycle_count == 20 and len(short.cycles) == 1
    for f in ("pumped_l", "returned_l", "retained_l", "duration_min"):
        assert getattr(short.totals, f) == pytest.approx(getattr(long.totals, f), rel=1e-9), f
