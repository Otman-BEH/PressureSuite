"""Exact single-state CoolProp evaluations for the calculator tools (stored energy, hydrostatic test).

The cascade fill model uses `thermo.Fluid`, which is tuned for many repeated flashes. The calculators evaluate a
handful of states per request, so they use the exact backend directly and add what they need on top: phase, isothermal
compressibility, ideal-gas heat capacity and the fluid's valid range. All values are SI with absolute pressures.

Pressures entered as gauge in these tools are relative to `P_GAUGE_REF` (1 bar a).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import CoolProp.CoolProp as CP

from .config import COOLPROP_BACKEND

P_GAUGE_REF = 1.0e5  # Pa; gauge pressures in the calculator tools are relative to 1 bar a

# CoolProp name -> display label. Gases and liquids that are sensible as a vessel or test fluid.
FLUID_LABELS: dict[str, str] = {
    "Nitrogen": "Nitrogen (N2)",
    "Helium": "Helium (He)",
    "Air": "Air",
    "Argon": "Argon (Ar)",
    "Oxygen": "Oxygen (O2)",
    "Hydrogen": "Hydrogen (H2)",
    "Methane": "Methane (CH4)",
    "CarbonDioxide": "Carbon dioxide (CO2)",
    "Water": "Water",
    "Ethanol": "Ethanol",
}

_GAS_PHASES = {CP.iphase_gas, CP.iphase_supercritical_gas, CP.iphase_supercritical}
_LIQUID_PHASES = {CP.iphase_liquid, CP.iphase_supercritical_liquid}


def barg_to_pa(p_barg: float) -> float:
    return p_barg * 1e5 + P_GAUGE_REF


def pa_to_barg(p_pa: float) -> float:
    return (p_pa - P_GAUGE_REF) / 1e5


@dataclass(frozen=True, slots=True)
class State:
    P: float  # Pa (absolute)
    T: float  # K
    rho: float  # kg/m3
    u: float  # J/kg
    h: float  # J/kg
    s: float  # J/kg/K
    phase: str  # "gas", "liquid" or "two_phase"
    Z: float  # compressibility factor P/(rho R T)
    kappa_T: float  # 1/Pa, isothermal compressibility (nan in the two-phase region)
    quality: float | None  # vapour mass fraction in the two-phase region, else None


@dataclass(frozen=True, slots=True)
class Limits:
    T_min: float  # K
    T_max: float  # K
    P_max: float  # Pa


_local = threading.local()


def _state(name: str):
    if name not in FLUID_LABELS:
        raise ValueError(f"Unknown fluid '{name}'. Choose one of: {', '.join(FLUID_LABELS)}.")
    cache = getattr(_local, "states", None)
    if cache is None:
        cache = _local.states = {}
    if name not in cache:
        cache[name] = CP.AbstractState(COOLPROP_BACKEND, name)
    return cache[name]


def limits(name: str) -> Limits:
    a = _state(name)
    return Limits(T_min=a.Tmin(), T_max=a.Tmax(), P_max=a.pmax())


def check_range(name: str, P: float, T: float) -> None:
    """Raise a clear ValueError if (P, T) is outside the range CoolProp's equation of state covers."""
    lim = limits(name)
    if not lim.T_min <= T <= lim.T_max:
        raise ValueError(f"{name}: temperature {T - 273.15:.1f} °C is outside the valid range "
                         f"{lim.T_min - 273.15:.1f} to {lim.T_max - 273.15:.1f} °C.")
    if P > lim.P_max:
        raise ValueError(f"{name}: pressure {pa_to_barg(P):.0f} barg is above the equation of state's limit "
                         f"({pa_to_barg(lim.P_max):.0f} barg).")
    if P <= 0:
        raise ValueError("Absolute pressure must be above zero.")


def _read(a) -> State:
    idx = a.phase()
    if idx in _GAS_PHASES:
        phase, quality = "gas", None
    elif idx in _LIQUID_PHASES:
        phase, quality = "liquid", None
    else:
        phase, quality = "two_phase", a.Q()
    try:
        kappa = a.isothermal_compressibility()
    except ValueError:
        kappa = float("nan")
    R = a.gas_constant() / a.molar_mass()
    return State(P=a.p(), T=a.T(), rho=a.rhomass(), u=a.umass(), h=a.hmass(), s=a.smass(), phase=phase,
                 Z=a.p() / (a.rhomass() * R * a.T()), kappa_T=kappa if phase != "two_phase" else float("nan"),
                 quality=quality)


def state_PT(name: str, P: float, T: float) -> State:
    check_range(name, P, T)
    a = _state(name)
    try:
        a.update(CP.PT_INPUTS, P, T)
    except ValueError as ex:
        raise ValueError(f"{name}: no single-phase state at {pa_to_barg(P):.2f} barg and {T - 273.15:.1f} °C "
                         f"(it may be on the saturation line): {ex}") from None
    return _read(a)


def state_Ps(name: str, P: float, s: float) -> State:
    """State reached by isentropic expansion to pressure P (may be two-phase)."""
    a = _state(name)
    try:
        a.update(CP.PSmass_INPUTS, P, s)
    except ValueError as ex:
        raise ValueError(f"{name}: isentropic expansion to {P / 1e5:.3f} bar a leaves CoolProp's range: {ex}") from None
    return _read(a)


def ideal_gamma(name: str, T: float) -> float:
    """Ideal-gas heat capacity ratio cp0/cv0 at temperature T."""
    a = _state(name)
    a.update(CP.DmassT_INPUTS, 1e-6, T)  # the ideal-gas part does not depend on density
    cp0 = a.cp0mass()
    R = a.gas_constant() / a.molar_mass()
    return cp0 / (cp0 - R)


def specific_gas_constant(name: str) -> float:
    """R / M in J/(kg K)."""
    a = _state(name)
    return a.gas_constant() / a.molar_mass()


def saturation_T(name: str, P: float) -> float | None:
    """Boiling temperature at pressure P, or None above the critical pressure."""
    a = _state(name)
    if P >= a.p_critical():
        return None
    a.update(CP.PQ_INPUTS, P, 0.0)
    return a.T()
