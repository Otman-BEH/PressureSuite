"""Hydrostatic test of a liquid-filled tank. Pure functions, SI units, gauge Pa relative to 1 bar a.

The tank starts full of liquid at 0 barg. Raising the pressure needs extra liquid because the liquid compresses and the
tank stretches. With m(p) = rho(p) * V(p) (see `vessel`), the extra mass between two pressures splits into

    compressibility:  V(p1) * (rho(p2) - rho(p1))
    tank expansion:   rho(p2) * (V(p2) - V(p1))

Volumes are reported as liquid at 1 bar a and the test temperature (what the pump delivers).

Volume check ("press and depress"). Pump a measured amount of liquid in between p1 and p2 (or measure what comes back
when venting from p2 to p1):
- Liquid-full tank: the tank volume follows from  m = rho2 V0 (1 + c p2) - rho1 V0 (1 + c p1).
- Tank with a gas pocket (trapped air or a deliberate ullage) and a known tank volume: the gas compresses isothermally
  from rho_g1 to rho_g2 (real gas, CoolProp), so with r = rho_g1 / rho_g2 the gas volume at p1 is
      Vg1 = (rho_l2 V(p2) - rho_l1 V(p1) - m) / (rho_l2 r - rho_l1).
  Gas dissolving in the liquid is ignored; it makes the pocket look larger on the way up than on the way down.
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import fluids
from ..stored_energy.physics import LiquidEnergy, Wall, liquid_energy
from ..vessel import Tank, density


@dataclass(frozen=True, slots=True)
class Transfer:
    """Liquid moved between two pressures: mass and volume at 1 bar a, split by cause."""

    mass_kg: float
    volume_m3: float
    compressibility_m3: float
    tank_m3: float


def transfer(fluid: str, tank: Tank, T: float, p_from: float, p_to: float) -> Transfer:
    """Liquid that must be pumped in to go from gauge p_from up to p_to (negative when going down)."""
    rho1, rho2 = density(fluid, p_from, T, "liquid"), density(fluid, p_to, T, "liquid")
    rho_ref = density(fluid, 0.0, T, "liquid")
    V1, V2 = tank.volume(p_from), tank.volume(p_to)
    comp = V1 * (rho2 - rho1)
    expand = rho2 * (V2 - V1)
    m = comp + expand
    return Transfer(mass_kg=m, volume_m3=m / rho_ref, compressibility_m3=comp / rho_ref, tank_m3=expand / rho_ref)


def peak_energy(fluid: str, tank: Tank, T: float, p_gauge: float) -> LiquidEnergy:
    """Stored energy at peak pressure: the stored energy tool's liquid calculation."""
    return liquid_energy(fluid, fluids.P_GAUGE_REF + p_gauge, T, fluids.P_GAUGE_REF, tank.V0, tank.wall)


def tank_volume_from_transfer(fluid: str, wall: Wall | None, T: float, p1: float, p2: float, mass_kg: float) -> float:
    """Liquid-full tank volume V0 (m3 at 0 barg) that takes `mass_kg` going from p1 to p2."""
    if p2 <= p1:
        raise ValueError("The upper pressure must be above the lower pressure.")
    c = Tank(1.0, wall).dilation
    rho1, rho2 = density(fluid, p1, T, "liquid"), density(fluid, p2, T, "liquid")
    return mass_kg / (rho2 * (1 + c * p2) - rho1 * (1 + c * p1))


def gas_pocket_volume(fluid: str, tank: Tank, T: float, p1: float, p2: float, mass_kg: float, gas: str = "Air") -> float:
    """Gas volume (m3, at p1) in a tank of known volume that takes `mass_kg` of liquid going from p1 to p2."""
    if p2 <= p1:
        raise ValueError("The upper pressure must be above the lower pressure.")
    rho_l1, rho_l2 = density(fluid, p1, T, "liquid"), density(fluid, p2, T, "liquid")
    r = density(gas, p1, T, "gas") / density(gas, p2, T, "gas")
    return (rho_l2 * tank.volume(p2) - rho_l1 * tank.volume(p1) - mass_kg) / (rho_l2 * r - rho_l1)


def pumped_with_gas_pocket(fluid: str, tank: Tank, T: float, p1: float, p2: float, gas_m3: float, gas: str = "Air") -> float:
    """Forward model of `gas_pocket_volume`: liquid mass taken in from p1 to p2 with a gas pocket of gas_m3 at p1."""
    rho_l1, rho_l2 = density(fluid, p1, T, "liquid"), density(fluid, p2, T, "liquid")
    r = density(gas, p1, T, "gas") / density(gas, p2, T, "gas")
    return rho_l2 * (tank.volume(p2) - r * gas_m3) - rho_l1 * (tank.volume(p1) - gas_m3)
