"""API schemas. Field names carry their units; gauge pressures (barg) are relative to 1 bar a."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..hydro_test.models import CycleIn, TimePointOut
from ..notes import NoteOut
from ..stored_energy.models import WallIn

GasFluid = Literal["Nitrogen", "Helium", "Air", "Argon", "Oxygen", "Hydrogen", "Methane"]

# Usual supply bundle pressure per gas; anything else defaults to 200 barg.
BUNDLE_PRESSURE_BARG: dict[str, float] = {"Nitrogen": 300.0, "Helium": 200.0}
DEFAULT_BUNDLE_PRESSURE_BARG = 200.0


class SupplyIn(BaseModel):
    bundle_volume_l: float = Field(default=600.0, gt=0, le=100_000, description="Bundle volume, e.g. 12 x 50 L")
    bundle_pressure_barg: float | None = Field(default=None, gt=0, le=1_000,
                                               description="Full bundle pressure; null = 300 barg for N2, 200 barg otherwise")
    residual_barg: float = Field(default=20.0, ge=0, le=1_000, description="Lowest pressure a booster can draw a bundle down to")


class GasTestRequest(BaseModel):
    fluid: GasFluid = "Nitrogen"
    volume_l: float = Field(gt=0, le=1_000_000, description="Vessel internal volume at 0 barg")
    temp_c: float = Field(default=20.0, ge=-100, le=300)
    wall: WallIn | None = Field(default=None, description="Vessel geometry and material, for its volumetric expansion")
    pressurisation_bar_min: float = Field(default=10.0, gt=0, le=100_000)
    vent_bar_min: float = Field(default=20.0, gt=0, le=100_000)
    cycles: list[CycleIn] = Field(min_length=1, max_length=100)
    repeat: int = Field(default=1, ge=1, le=100_000, description="Run the cycle list this many times")
    supply: SupplyIn = Field(default_factory=SupplyIn)


class GasCycleOut(BaseModel):
    index: int
    start_barg: float
    target_barg: float
    hold_min: float
    end_hold_barg: float
    vent_barg: float
    vent_hold_min: float
    hold_drop_bar: float
    leak_rate_bar_min: float | None  # from the measured end of hold
    filled_kg: float
    filled_nm3: float  # normal m3 at 0 °C and 1 atm
    vented_kg: float
    vented_nm3: float
    leaked_kg: float
    energy_kj: float  # real-gas isentropic expansion at peak pressure
    tnt_kg: float
    duration_min: float


class GasTotalsOut(BaseModel):
    test_pressure_barg: float  # highest target
    cycle_count: int  # cycles over all repeats
    used_kg: float  # everything put in over all cycles
    used_nm3: float
    vented_kg: float
    leaked_kg: float
    left_in_vessel_kg: float  # above the 0 barg starting contents
    peak_energy_kj: float
    duration_min: float


class SupplyOut(BaseModel):
    bundle_pressure_barg: float
    bundle_volume_l: float
    bundle_contents_kg: float  # full bundle down to 0 barg
    bundle_contents_nm3: float
    decant_usable_kg: float | None  # per bundle, drawn down to the highest target (None: bundle not above it)
    bundles_decant: int | None
    booster_usable_kg: float  # per bundle, drawn down to the residual pressure
    bundles_booster: int


class GasTestResponse(BaseModel):
    cycles: list[GasCycleOut]
    totals: GasTotalsOut
    supply: SupplyOut
    timeline: list[TimePointOut]
    notes: list[NoteOut]


class GasTestMeta(BaseModel):
    bundle_pressure_barg: dict[str, float]
    default_bundle_pressure_barg: float
    fluids: list[Literal["Nitrogen", "Helium", "Air", "Argon", "Oxygen", "Hydrogen", "Methane"]]
