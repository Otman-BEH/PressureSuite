"""CoolProp wrapper.

Every vessel state in the model is known by its density and one more quantity
(temperature, entropy or energy). Density-temperature evaluations are direct
Helmholtz-energy evaluations (a few us), so the two flashes the fill model needs
are solved here with Newton iterations on temperature, falling back to
CoolProp's own flash routines if Newton does not converge (e.g. two-phase).

The pressure-based flashes used by pumps and the heat exchanger (P-T, P-h, P-s)
are iterative and ~100x slower in HEOS, so they use CoolProp's bicubic tables
when the gas is warm. Measured against HEOS between 0.5 and 1000 bar the tables
agree to better than 1e-5 above ~190 K (nitrogen) / ~150 K (helium), but near
the saturation dome, the critical point or below the table range they return
wrong values without raising, so colder gas always goes to HEOS.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass

import CoolProp
import CoolProp.CoolProp as CP

from .config import COOLPROP_BACKEND, COOLPROP_TABULAR

TABLE_P_MIN, TABLE_P_MAX = 0.5e5, 1000e5  # Pa, range the tables were checked over
TABLE_MARGIN = 30.0  # K kept between an upstream temperature hint and the safe limit


@dataclass(frozen=True, slots=True)
class GasState:
    rho: float  # kg/m3
    T: float  # K
    P: float  # Pa (absolute)
    u: float  # J/kg
    s: float  # J/kg/K
    h: float  # J/kg
    cv: float  # J/kg/K (nan in the two-phase region)
    cp: float  # J/kg/K (nan in the two-phase region)


def _read(a) -> GasState:
    try:
        cv, cp = a.cvmass(), a.cpmass()
    except ValueError:
        cv = cp = math.nan
    return GasState(a.rhomass(), a.T(), a.p(), a.umass(), a.smass(), a.hmass(), cv, cp)


class Fluid:
    """Pure-fluid property evaluator. Not thread-safe: use `get_fluid`."""

    def __init__(self, name: str, backend: str = COOLPROP_BACKEND, tabular: str = COOLPROP_TABULAR):
        self.name = name
        self._as = CP.AbstractState(backend, name)
        self.T_min = self._as.Tmin()
        self.T_max = self._as.Tmax()
        self.T_safe = max(1.5 * self._as.T_critical(), 150.0)  # tables are trusted above this
        self._tabular_name = tabular
        self._tab = None  # created on first use (loading the tables takes ~1 s)

    # ---------------------------------------------------------------- tables

    def _table(self, T_hint: float, P: float):
        """The tabular state if the gas is warm enough and the pressure in range, else None."""
        if not self._tabular_name or not (TABLE_P_MIN <= P <= TABLE_P_MAX) or T_hint < self.T_safe + TABLE_MARGIN:
            return None
        if self._tab is None:
            try:
                self._tab = CP.AbstractState(self._tabular_name, self.name)
            except ValueError:
                self._tabular_name = ""
                return None
        return self._tab

    def _pressure_flash(self, pair: int, a: float, b: float, P: float, T_hint: float) -> GasState:
        tab = self._table(T_hint, P)
        if tab is not None:
            try:
                tab.update(pair, a, b)
                if self.T_safe <= tab.T() <= self.T_max:
                    return _read(tab)
            except ValueError:
                pass
        self._as.update(pair, a, b)
        return _read(self._as)

    # ---------------------------------------------------------------- direct

    def at_DT(self, rho: float, T: float) -> GasState:
        self._as.update(CP.DmassT_INPUTS, rho, T)
        return _read(self._as)

    def P_DT(self, rho: float, T: float) -> float:
        self._as.update(CP.DmassT_INPUTS, rho, T)
        return self._as.p()

    def rho_PT(self, P: float, T: float) -> float:
        """Exact (sets target masses and initial states; not in any hot loop)."""
        self._as.update(CP.PT_INPUTS, P, T)
        return self._as.rhomass()

    def at_PT(self, P: float, T: float) -> GasState:
        return self._pressure_flash(CP.PT_INPUTS, P, T, P, T)

    def at_Ph(self, h: float, P: float, T_hint: float = 0.0) -> GasState:
        """`T_hint`: a temperature the result is known to be above (enables the tables)."""
        return self._pressure_flash(CP.HmassP_INPUTS, h, P, P, T_hint)

    def h_Ps(self, P: float, s: float, T_hint: float = 0.0) -> float:
        return self._pressure_flash(CP.PSmass_INPUTS, P, s, P, T_hint).h

    # ---------------------------------------------------------------- Newton flashes

    def at_Ds(self, rho: float, s: float, T_guess: float) -> GasState:
        """State at density `rho` with specific entropy `s` (isentropic expansion)."""
        a, T = self._as, T_guess
        for _ in range(12):
            try:
                a.update(CP.DmassT_INPUTS, rho, T)
                cv = a.cvmass()
            except ValueError:
                break
            if not cv > 0:
                break
            dT = (a.smass() - s) * T / cv  # (ds/dT)_rho = cv / T
            if abs(dT) < 1e-9 * T:
                return _read(a)
            T -= dT
            if not self.T_min < T < self.T_max:
                break
        a.update(CP.DmassSmass_INPUTS, rho, s)
        return _read(a)

    def at_DE(self, rho: float, m: float, E: float, wall_C: float, T0: float, T_guess: float) -> GasState:
        """State of a gas + wall system in thermal equilibrium.

        Solves  m*u(rho, T) + wall_C*(T - T0) = E  for T. With wall_C = 0 this is
        a plain density-internal energy flash.
        """
        a, T = self._as, T_guess
        for _ in range(12):
            try:
                a.update(CP.DmassT_INPUTS, rho, T)
                cv = a.cvmass()
            except ValueError:
                break
            if not cv > 0:
                break
            dT = (m * a.umass() + wall_C * (T - T0) - E) / (m * cv + wall_C)
            if abs(dT) < 1e-9 * T:
                return _read(a)
            T -= dT
            if not self.T_min < T < self.T_max:
                break
        if wall_C == 0:
            a.update(CP.DmassUmass_INPUTS, rho, E / m)
            return _read(a)
        # Energy is monotonic in T at fixed density: bisect.
        lo, hi = self.T_min * 1.001, self.T_max * 0.999
        for _ in range(100):
            mid = 0.5 * (lo + hi)
            a.update(CP.DmassT_INPUTS, rho, mid)
            if m * a.umass() + wall_C * (mid - T0) > E:
                hi = mid
            else:
                lo = mid
            if hi - lo < 1e-7 * mid:
                break
        return self.at_DT(rho, 0.5 * (lo + hi))


_local = threading.local()


def get_fluid(name: str) -> Fluid:
    """Per-thread cached Fluid (CoolProp AbstractState objects are not thread-safe)."""
    cache = getattr(_local, "fluids", None)
    if cache is None:
        cache = _local.fluids = {}
    if name not in cache:
        cache[name] = Fluid(name)
    return cache[name]


def coolprop_version() -> str:
    return CoolProp.__version__


def eos_reference(name: str) -> str:
    try:
        return CP.get_fluid_param_string(name, "BibTeX-EOS")
    except ValueError:
        return "unknown"
