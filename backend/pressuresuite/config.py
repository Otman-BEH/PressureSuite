"""Paths, constants, CoolProp settings and unit helpers shared by every tool.

The API speaks engineering units (barg, °C, litres, kg); everything inside the
models is SI with absolute pressures.
"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
# The built web page (`npm run build` in frontend/). When it exists the API serves it at /.
WEB_DIR = REPO_DIR / "frontend" / "dist"

API_VERSION = "0.1.0"

P_ATM = 101_325.0  # Pa; gauge pressures are relative to this
T_NORMAL = 273.15  # K; normal cubic metres (Nm3) are at 0 °C and 1 atm
COOLPROP_BACKEND = os.environ.get("COOLPROP_BACKEND", "HEOS")  # "REFPROP" if licensed
# Bicubic tables for warm-gas P-T/P-h/P-s flashes (pumps, heat exchanger); "" = always use the exact backend.
COOLPROP_TABULAR = os.environ.get("COOLPROP_TABULAR", f"BICUBIC&{COOLPROP_BACKEND}")


def barg_to_pa(p_barg: float) -> float:
    return p_barg * 1e5 + P_ATM


def pa_to_barg(p_pa: float) -> float:
    return (p_pa - P_ATM) / 1e5


def c_to_k(t_c: float) -> float:
    return t_c + 273.15


def k_to_c(t_k: float) -> float:
    return t_k - 273.15
