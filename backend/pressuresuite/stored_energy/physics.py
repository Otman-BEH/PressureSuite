"""Stored energy of a pressurised vessel. Pure functions, SI units, absolute pressures unless named `*_gauge`.

Gas
- Real gas (primary): the gas expands isentropically from (P1, T1) to ambient pressure Pa. The energy released is the
  drop in internal energy minus the work done pushing back the atmosphere:
      E = m * [(u1 - u2s) - Pa * (v2s - v1)],   state 2s = (Pa, s1)
  with all properties from CoolProp.
- Ideal gas, Brode:                 E = (P1 - Pa) * V / (gamma - 1)
- Ideal gas, isentropic (Lloyd / ASME PCC-2 form):
                                    E = P1 * V / (gamma - 1) * [1 - (Pa / P1) ** ((gamma - 1) / gamma)]
  gamma is the ideal-gas cp0/cv0 at the vessel temperature. This form keeps the work done on the atmosphere, so the
  real-gas m * (u1 - u2s) is also reported for a like-for-like comparison.

Liquid
- Compressibility:  E = p^2 * V / (2 K),  p = gauge pressure, K = isothermal bulk modulus 1/kappa_T at the state.
- Vessel wall (thin-wall membrane, optional): elastic strain energy of the shell, which equals p * dV_wall / 2:
      cylinder (closed ends, heads ignored):  U = p^2 D V (5 - 4 nu) / (8 t E)
      sphere:                                 U = 3 p^2 D V (1 - nu) / (8 t E)

Equivalents (for context only, not a blast or hazard assessment)
- W_TNT = E / 4.184 MJ/kg.
- Hand grenade: an M67 holds 180 g of Composition B, about 1.33 times as energetic as TNT, so one grenade is
  0.180 * 1.33 * 4.184 MJ = 1.0 MJ.
- Car crash: a 1500 kg car at 100 km/h, E = m v^2 / 2 = 579 kJ.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .. import fluids

TNT_J_PER_KG = 4.184e6
GRENADE_TNT_KG = 0.180 * 1.33  # M67: 180 g Composition B, TNT equivalence ~1.33
GRENADE_J = GRENADE_TNT_KG * TNT_J_PER_KG
CAR_J = 0.5 * 1500 * (100 / 3.6) ** 2
CAR_REFERENCE = "1500 kg car at 100 km/h, m v² / 2"
GRENADE_REFERENCE = "M67 hand grenade: 180 g Composition B x 1.33 TNT equivalence x 4.184 MJ/kg"


# ------------------------------------------------------------------------------------------------ gas


@dataclass(frozen=True, slots=True)
class GasEnergy:
    real_j: float  # isentropic expansion, real gas (CoolProp), atmospheric work subtracted
    real_expansion_work_j: float  # m (u1 - u2s): same basis as the ideal isentropic formula (atmospheric work kept)
    brode_j: float  # ideal gas, Brode
    ideal_isentropic_j: float  # ideal gas, isentropic
    gamma: float
    mass_kg: float
    Z: float
    end_T: float  # K, after isentropic expansion
    end_quality: float | None  # vapour fraction if the expansion ends two-phase


def brode_energy(P1: float, Pa: float, V: float, gamma: float) -> float:
    return (P1 - Pa) * V / (gamma - 1)


def ideal_isentropic_energy(P1: float, Pa: float, V: float, gamma: float) -> float:
    return P1 * V / (gamma - 1) * (1 - (Pa / P1) ** ((gamma - 1) / gamma))


def real_isentropic_energy(fluid: str, P1: float, T1: float, Pa: float, V: float) -> tuple[float, fluids.State, fluids.State]:
    """Energy released by isentropic expansion to Pa, with the start and end states."""
    s1 = fluids.state_PT(fluid, P1, T1)
    s2 = fluids.state_Ps(fluid, Pa, s1.s)
    m = s1.rho * V
    e = m * ((s1.u - s2.u) - Pa * (1 / s2.rho - 1 / s1.rho))
    return e, s1, s2


def gas_energy(fluid: str, P1: float, T1: float, Pa: float, V: float) -> GasEnergy:
    if P1 <= Pa:
        raise ValueError("Vessel pressure must be above ambient pressure.")
    real, s1, s2 = real_isentropic_energy(fluid, P1, T1, Pa, V)
    g = fluids.ideal_gamma(fluid, T1)
    m = s1.rho * V
    return GasEnergy(real_j=real, real_expansion_work_j=m * (s1.u - s2.u), brode_j=brode_energy(P1, Pa, V, g),
                     ideal_isentropic_j=ideal_isentropic_energy(P1, Pa, V, g), gamma=g, mass_kg=m, Z=s1.Z, end_T=s2.T,
                     end_quality=s2.quality)


# ------------------------------------------------------------------------------------------------ liquid

Shape = Literal["cylinder", "sphere"]


@dataclass(frozen=True, slots=True)
class Wall:
    """Thin vessel wall. D: inner diameter (m), t: thickness (m), E: Young's modulus (Pa), nu: Poisson's ratio."""

    shape: Shape
    D: float
    t: float
    E: float
    nu: float = 0.3

    def __post_init__(self):
        if self.D <= 0 or self.t <= 0 or self.E <= 0:
            raise ValueError("Wall diameter, thickness and Young's modulus must be positive.")
        if not 0 <= self.nu < 0.5:
            raise ValueError("Poisson's ratio must be between 0 and 0.5.")


def wall_dilation_per_pa(wall: Wall) -> float:
    """Volume change per unit volume and per Pa of internal gauge pressure (thin-wall membrane theory)."""
    if wall.shape == "cylinder":
        return wall.D * (5 - 4 * wall.nu) / (4 * wall.t * wall.E)
    return 3 * wall.D * (1 - wall.nu) / (4 * wall.t * wall.E)


def wall_strain_energy(p_gauge: float, V: float, wall: Wall) -> float:
    """Elastic strain energy of the wall: p * dV / 2 for a linear-elastic shell."""
    return 0.5 * p_gauge ** 2 * V * wall_dilation_per_pa(wall)


def liquid_compression_energy(p_gauge: float, V: float, K: float) -> float:
    """E = p^2 V / (2 K)."""
    return p_gauge ** 2 * V / (2 * K)


@dataclass(frozen=True, slots=True)
class LiquidEnergy:
    fluid_j: float
    wall_j: float | None  # None when no wall data was given
    bulk_modulus_pa: float
    density: float
    mass_kg: float

    @property
    def total_j(self) -> float:
        return self.fluid_j + (self.wall_j or 0.0)


def liquid_energy(fluid: str, P: float, T: float, Pa: float, V: float, wall: Wall | None = None) -> LiquidEnergy:
    """Hydrostatic stored energy of a liquid-filled vessel at absolute pressure P (gauge = P - Pa).

    K is the isothermal bulk modulus at the given state. Shared by the stored energy and hydrostatic test tools.
    """
    st = fluids.state_PT(fluid, P, T)
    if st.phase != "liquid":
        raise ValueError(f"{fluid} is not a liquid at {fluids.pa_to_barg(P):.1f} barg and {T - 273.15:.1f} °C; "
                         "use the gas calculation.")
    K = 1 / st.kappa_T
    p = P - Pa
    return LiquidEnergy(fluid_j=liquid_compression_energy(p, V, K),
                        wall_j=wall_strain_energy(p, V, wall) if wall else None,
                        bulk_modulus_pa=K, density=st.rho, mass_kg=st.rho * V)


# ------------------------------------------------------------------------------------------------ equivalents


def tnt_mass(energy_j: float, factor_j_per_kg: float = TNT_J_PER_KG) -> float:
    return energy_j / factor_j_per_kg
