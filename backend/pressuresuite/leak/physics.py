"""Leak rate from a measured pressure decay in a closed vessel. Pure functions, SI units, gauge Pa relative to 1 bar a.

The leak rate is the pressure decay over the hold, (p0 - p1) / t in bar/min. For reference it is also expressed as the
mass lost, m(p0) - m(p1) (see `vessel`), per minute and in the usual flow units:
- liquids: mL/min of liquid at 1 bar a and the test temperature
- gases: sccm (standard cm3/min) and NL/min, both at 0 °C and 1 atm, and mbar·L/s (pV throughput at the test
  temperature, mdot = Q / (R_specific T))

The vessel stays at a fixed temperature; a temperature change during the hold shows up as a leak (or a gain).
"""

from __future__ import annotations

from typing import Literal

from .. import fluids
from ..config import P_ATM, T_NORMAL
from ..vessel import Phase, Tank, contents, density

LeakUnit = Literal["ml_min", "sccm", "nl_min", "mbar_l_s"]
UNIT_LABELS: dict[str, str] = {"ml_min": "mL/min", "sccm": "sccm", "nl_min": "NL/min", "mbar_l_s": "mbar·L/s"}
UNITS_FOR: dict[str, tuple[str, ...]] = {"liquid": ("ml_min",), "gas": ("sccm", "nl_min", "mbar_l_s")}


def phase_at_reference(fluid: str, T: float) -> Phase:
    st = fluids.state_PT(fluid, fluids.P_GAUGE_REF, T)
    if st.phase == "two_phase":
        raise ValueError(f"{fluid} is boiling at 1 bar a and {T - 273.15:.1f} °C.")
    return st.phase  # type: ignore[return-value]


def per_unit_kg_s(fluid: str, T: float, unit: str) -> float:
    """Mass rate (kg/s) of one unit of flow."""
    if unit == "ml_min":
        return density(fluid, 0.0, T, "liquid") * 1e-6 / 60
    if unit == "mbar_l_s":
        return 0.1 / (fluids.specific_gas_constant(fluid) * T)  # 1 mbar·L/s = 100 Pa * 1e-3 m3/s = 0.1 Pa·m3/s
    if unit in ("sccm", "nl_min"):
        rho_n = fluids.state_PT(fluid, P_ATM, T_NORMAL).rho
        return rho_n * (1e-6 / 60 if unit == "sccm" else 1e-3 / 60)
    raise ValueError(f"Unknown leak unit '{unit}'.")


def mass_lost(fluid: str, tank: Tank, T: float, p0: float, p1: float) -> float:
    """Mass (kg) the vessel loses going from p0 down to p1."""
    if p1 > p0:
        raise ValueError("The end pressure is above the start pressure. A rise usually means the contents warmed up, "
                         "not a leak.")
    return contents(fluid, tank, T, p0) - contents(fluid, tank, T, p1)
