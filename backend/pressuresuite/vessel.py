"""A vessel holding one fluid at a fixed temperature: contents vs pressure, for the test and leak calculators.

The vessel has volume V(p) = V0 * (1 + c * p_gauge), where c is the thin-wall dilation per Pa (0 for a rigid vessel). At
gauge pressure p the contents are m(p) = rho(p, T) * V(p), with rho from CoolProp. Everything is isothermal.
Pressures are gauge Pa relative to `fluids.P_GAUGE_REF` (1 bar a).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from . import fluids
from .stored_energy.physics import Wall, wall_dilation_per_pa

Phase = Literal["gas", "liquid"]


@dataclass(frozen=True, slots=True)
class Tank:
    V0: float  # m3 at 0 barg
    wall: Wall | None = None

    @property
    def dilation(self) -> float:
        return wall_dilation_per_pa(self.wall) if self.wall else 0.0

    def volume(self, p_gauge: float) -> float:
        return self.V0 * (1 + self.dilation * p_gauge)


def density(fluid: str, p_gauge: float, T: float, phase: Phase | None = None) -> float:
    st = fluids.state_PT(fluid, fluids.P_GAUGE_REF + p_gauge, T)
    if phase is not None and st.phase != phase:
        raise ValueError(f"{fluid} is not a {phase} at {p_gauge / 1e5:.1f} barg and {T - 273.15:.1f} °C.")
    return st.rho


def contents(fluid: str, tank: Tank, T: float, p_gauge: float, phase: Phase | None = None) -> float:
    """Mass in the vessel at gauge pressure p (kg)."""
    return density(fluid, p_gauge, T, phase) * tank.volume(p_gauge)


def pressure_for(fluid: str, tank: Tank, T: float, mass: float, p_hi: float, phase: Phase | None = None) -> float:
    """Gauge pressure at which the vessel holds `mass`, searched in [0, p_hi]. Returns 0 if even 0 barg holds more."""
    if mass <= contents(fluid, tank, T, 0.0, phase):
        return 0.0
    lo, hi = 0.0, p_hi
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if contents(fluid, tank, T, mid, phase) > mass:
            hi = mid
        else:
            lo = mid
        if hi - lo < 1e-3:  # 1 mPa
            break
    return 0.5 * (lo + hi)
