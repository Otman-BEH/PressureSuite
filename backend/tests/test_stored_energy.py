"""Stored energy against hand calculations, gas vs liquid magnitude and the equivalents."""

import math

import pytest
from fastapi.testclient import TestClient

from pressuresuite.api.app import app
from pressuresuite.fluids import P_GAUGE_REF
from pressuresuite.stored_energy import StoredEnergyRequest, stored_energy
from pressuresuite.stored_energy.physics import (
    GRENADE_J,
    TNT_J_PER_KG,
    Wall,
    brode_energy,
    gas_energy,
    ideal_isentropic_energy,
    liquid_compression_energy,
    liquid_energy,
    tnt_mass,
    wall_dilation_per_pa,
    wall_strain_energy,
)

T20 = 293.15
client = TestClient(app)


def calc(**kw):
    return stored_energy(StoredEnergyRequest(**kw))


# ------------------------------------------------------------------------------------------------ liquid


def test_one_litre_of_water_at_100_bar():
    # Hand: K(water, 20 °C) ~ 2.2 GPa  ->  E = (1e7)^2 * 1e-3 / (2 * 2.2e9) = 22.7 J
    assert liquid_compression_energy(1e7, 1e-3, 2.2e9) == pytest.approx(22.727, rel=1e-4)
    liq = liquid_energy("Water", P_GAUGE_REF + 1e7, T20, P_GAUGE_REF, 1e-3)
    assert liq.bulk_modulus_pa == pytest.approx(2.2e9, rel=0.03)
    assert liq.fluid_j == pytest.approx(22.7, rel=0.03)
    assert liq.wall_j is None


def test_liquid_formula_agrees_with_isentropic_expansion_for_cold_water():
    r = calc(fluid="Water", volume_l=1, pressure_barg=100)
    assert r.phase == "liquid"
    assert r.liquid.isentropic_kj == pytest.approx(r.liquid.fluid_kj, rel=0.03)
    assert not r.liquid.flashes
    assert any("wall strain energy not included" in n.text and n.level == "assumption" for n in r.notes)


def test_wall_strain_energy_by_hand():
    p, V = 3e7, 0.1
    cyl = Wall("cylinder", D=0.3, t=0.008, E=200e9, nu=0.3)
    # U = p^2 D V (5 - 4 nu) / (8 t E)
    assert wall_strain_energy(p, V, cyl) == pytest.approx(9e14 * 0.3 * 0.1 * 3.8 / (8 * 0.008 * 200e9), rel=1e-12)
    sph = Wall("sphere", D=0.5, t=0.005, E=70e9, nu=0.33)
    # U = 3 p^2 D V (1 - nu) / (8 t E)
    assert wall_strain_energy(p, V, sph) == pytest.approx(3 * 9e14 * 0.5 * 0.1 * 0.67 / (8 * 0.005 * 70e9), rel=1e-12)
    # Linear elastic: strain energy = p * dV / 2.
    for w in (cyl, sph):
        assert wall_strain_energy(p, V, w) == pytest.approx(0.5 * p * V * wall_dilation_per_pa(w) * p, rel=1e-12)


def test_wall_energy_is_added_when_given():
    wall = {"shape": "cylinder", "inner_diameter_mm": 300, "thickness_mm": 8, "youngs_modulus_gpa": 200}
    r = calc(fluid="Water", volume_l=100, pressure_barg=300, wall=wall)
    assert r.liquid.wall_kj == pytest.approx(8.0156, rel=1e-3)
    assert r.energy_kj == pytest.approx(r.liquid.fluid_kj + r.liquid.wall_kj)


def test_hot_water_flags_flashing():
    r = calc(fluid="Water", volume_l=10, pressure_barg=10, temp_c=150)
    assert r.liquid.flashes
    assert r.liquid.isentropic_kj > 1000 * r.liquid.fluid_kj


# ------------------------------------------------------------------------------------------------ gas


def test_ten_litre_nitrogen_bottle_at_300_bar_ideal_values():
    # Hand, gamma = 1.4, P1 = 301 bar a, Pa = 1 bar a, V = 0.01 m3:
    #   Brode       (P1 - Pa) V / (gamma - 1) = 300e5 * 0.01 / 0.4                       = 750.0 kJ
    #   isentropic  P1 V / (gamma - 1) * (1 - (Pa/P1)^(0.4/1.4)) = 752.5 kJ * (1 - 0.1964) = 604.7 kJ
    assert brode_energy(301e5, 1e5, 0.01, 1.4) == pytest.approx(750e3, rel=1e-9)
    assert ideal_isentropic_energy(301e5, 1e5, 0.01, 1.4) == pytest.approx(604.7e3, rel=1e-3)
    r = calc(fluid="Nitrogen", volume_l=10, pressure_barg=300)
    assert r.phase == "gas"
    assert r.pressure_bara == pytest.approx(301.0)
    assert r.gas.gamma == pytest.approx(1.40, abs=0.005)
    assert r.gas.ideal_brode_kj == pytest.approx(750, rel=0.005)
    assert r.gas.ideal_isentropic_kj == pytest.approx(604.7, rel=0.005)


def test_ten_litre_nitrogen_bottle_real_gas():
    g = gas_energy("Nitrogen", 301e5, T20, 1e5, 0.01)
    # Z ~ 1.14 at 300 bar: less gas than the ideal-gas law predicts, so less energy than the ideal isentropic value.
    assert g.Z == pytest.approx(1.14, abs=0.01)
    assert g.mass_kg == pytest.approx(3.03, rel=0.01)
    assert 0.5 * g.ideal_isentropic_j < g.real_expansion_work_j < g.ideal_isentropic_j
    # Subtracting the work done on the atmosphere lowers it further.
    assert g.real_j < g.real_expansion_work_j
    # From 20 °C and 300 bar the isentropic end state is inside nitrogen's dome at 1 bar a (-195.8 °C).
    assert g.end_quality is not None and 0.5 < g.end_quality < 1
    assert g.end_T - 273.15 == pytest.approx(-195.8, abs=0.3)


def test_real_gas_matches_ideal_gas_at_low_pressure():
    # Near 1 atm nitrogen is ideal; the like-for-like real value must match the ideal isentropic formula.
    g = gas_energy("Nitrogen", 3e5, T20, 1e5, 0.01)
    assert g.real_expansion_work_j == pytest.approx(g.ideal_isentropic_j, rel=0.01)
    assert g.end_quality is None


def test_gas_energy_is_orders_of_magnitude_above_liquid():
    for v, p in ((1, 100), (10, 300)):
        gas = calc(fluid="Nitrogen", volume_l=v, pressure_barg=p)
        liquid = calc(fluid="Water", volume_l=v, pressure_barg=p)
        assert gas.energy_kj > 100 * liquid.energy_kj


# ------------------------------------------------------------------------------------------------ equivalents


def test_tnt_equivalent():
    assert TNT_J_PER_KG == 4.184e6
    assert tnt_mass(4.184e6) == pytest.approx(1.0)
    r = calc(fluid="Nitrogen", volume_l=10, pressure_barg=300)
    assert r.tnt.tnt_kg == pytest.approx(r.energy_kj * 1e3 / 4.184e6)


def test_hand_grenade_equivalent():
    # Hand: M67 = 180 g Composition B x 1.33 TNT equivalence x 4.184 MJ/kg = 1.0017 MJ
    assert GRENADE_J == pytest.approx(1.0017e6, rel=1e-4)
    r = calc(fluid="Nitrogen", volume_l=10, pressure_barg=300)
    grenade, car = r.equivalents
    assert grenade.name == "Hand grenade"
    assert grenade.unit_kj == pytest.approx(1001.7, rel=1e-4)
    assert grenade.count == pytest.approx(r.energy_kj / grenade.unit_kj)
    # Hand: 1500 kg at 100 km/h (27.78 m/s): 0.5 * 1500 * 27.78^2 = 578.7 kJ
    assert car.unit_kj == pytest.approx(578.7, rel=1e-3)
    assert car.count == pytest.approx(r.energy_kj / car.unit_kj)


# ------------------------------------------------------------------------------------------------ validation and API


@pytest.mark.parametrize("body, fragment", [
    ({"fluid": "Nitrogen", "volume_l": -1, "pressure_barg": 100}, "volume_l"),
    ({"fluid": "Oxygen", "volume_l": 10, "pressure_barg": 900}, "limit"),
    ({"fluid": "Water", "volume_l": 10, "pressure_barg": 100, "temp_c": -50}, "outside the valid range"),
    ({"fluid": "Kryptonite", "volume_l": 10, "pressure_barg": 100}, "fluid"),
])
def test_invalid_inputs_return_clear_errors(body, fragment):
    res = client.post("/api/stored-energy/calculate", json=body)
    assert res.status_code == 422
    assert fragment in str(res.json()["detail"])


def test_api_round_trip_and_meta():
    res = client.post("/api/stored-energy/calculate", json={"fluid": "Nitrogen", "volume_l": 10, "pressure_barg": 300})
    assert res.status_code == 200
    body = res.json()
    assert body["phase"] == "gas" and math.isfinite(body["energy_kj"])
    meta = client.get("/api/stored-energy/meta").json()
    assert meta["gauge_reference_bara"] == 1.0
    assert {f["name"] for f in meta["fluids"]} >= {"Nitrogen", "Helium", "Air", "Water"}
