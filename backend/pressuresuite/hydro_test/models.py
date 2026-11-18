"""API schemas. Field names carry their units; gauge pressures (barg) are relative to 1 bar a."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..notes import NoteOut
from ..stored_energy.models import WallIn

TestFluid = Literal["Water", "Ethanol"]


class CycleIn(BaseModel):
    target_barg: float = Field(gt=0, le=10_000, description="Peak pressure of the cycle")
    hold_min: float = Field(default=5.0, ge=0, le=100_000, description="Hold at the target pressure")
    vent_barg: float = Field(default=0.0, ge=0, le=10_000, description="Pressure the cycle vents down to")
    vent_hold_min: float = Field(default=0.0, ge=0, le=100_000, description="Hold at the vent-down pressure")
    measured_end_hold_barg: float | None = Field(default=None, ge=0, le=10_000,
                                                 description="Pressure measured at the end of the hold; gives the leak rate")


class HydroTestRequest(BaseModel):
    fluid: TestFluid = "Water"
    volume_l: float = Field(gt=0, le=1_000_000, description="Tank internal volume at 0 barg")
    temp_c: float = Field(default=20.0, ge=-100, le=300)
    wall: WallIn | None = Field(default=None, description="Tank geometry and material, for its volumetric expansion")
    pressurisation_bar_min: float = Field(default=10.0, gt=0, le=100_000)
    vent_bar_min: float = Field(default=20.0, gt=0, le=100_000)
    cycles: list[CycleIn] = Field(min_length=1, max_length=100)
    repeat: int = Field(default=1, ge=1, le=100_000, description="Run the cycle list this many times")


class CycleOut(BaseModel):
    index: int
    start_barg: float
    target_barg: float
    hold_min: float
    end_hold_barg: float  # measured end of the hold (= target when not measured)
    vent_barg: float
    vent_hold_min: float
    hold_drop_bar: float
    leak_rate_bar_min: float | None  # from the measured end of hold
    pumped_kg: float
    pumped_l: float  # at 1 bar a and the test temperature
    pumped_compressibility_l: float
    pumped_tank_l: float
    returned_kg: float
    returned_l: float
    leaked_l: float  # lost during the hold, from the measured drop
    energy_kj: float  # at peak pressure, liquid + wall
    energy_fluid_kj: float
    energy_wall_kj: float | None
    duration_min: float


class TotalsOut(BaseModel):
    test_pressure_barg: float  # highest target
    cycle_count: int  # cycles over all repeats
    pumped_kg: float
    pumped_l: float
    returned_kg: float
    returned_l: float
    leaked_l: float
    retained_l: float  # still in the tank above the starting fill at the end
    peak_energy_kj: float
    duration_min: float


class TimePointOut(BaseModel):
    t_min: float
    pressure_barg: float
    phase: str
    cycle: int


class HydroTestResponse(BaseModel):
    density_kg_m3: float  # at 1 bar a
    bulk_modulus_mpa: float  # at 1 bar a
    tank_dilation_per_bar: float | None  # dV/V per bar, with geometry
    cycles: list[CycleOut]
    totals: TotalsOut
    timeline: list[TimePointOut]
    notes: list[NoteOut]


class VolumeRunIn(BaseModel):
    """One press (and optionally depress) between two pressures."""

    from_barg: float = Field(default=0.0, ge=0, le=10_000)
    to_barg: float = Field(gt=0, le=10_000)
    pumped_l: float = Field(gt=0, le=1_000_000, description="Liquid pumped in from from_barg to to_barg, at 1 bar a")
    returned_l: float | None = Field(default=None, gt=0, le=1_000_000,
                                     description="Liquid returned venting from to_barg back to from_barg, at 1 bar a")


class VolumeCheckRequest(BaseModel):
    """Find the tank volume, or the gas pocket in it, from repeated measurements of liquid pumped in (and returned)."""

    mode: Literal["tank", "gas_pocket"] = "tank"
    fluid: TestFluid = "Water"
    temp_c: float = Field(default=20.0, ge=-100, le=300)
    wall: WallIn | None = None
    volume_l: float | None = Field(default=None, gt=0, le=1_000_000, description="Known tank volume (needed for gas_pocket)")
    pocket_gas: Literal["Air", "Nitrogen", "Helium"] = "Air"
    runs: list[VolumeRunIn] = Field(min_length=1, max_length=50)


class VolumeRunOut(BaseModel):
    index: int
    from_press_l: float  # tank volume, or gas pocket at 1 bar a
    from_depress_l: float | None
    difference_pct: float | None  # press vs depress
    expected_pumped_l: float | None  # what a gas-free tank of the entered volume would take


class VolumeCheckResponse(BaseModel):
    mode: Literal["tank", "gas_pocket"]
    runs: list[VolumeRunOut]
    mean_l: float  # over every press and depress value; gas pocket: at 1 bar a
    spread_pct: float | None  # (max - min) / mean over all values, with more than one value
    count: int
    pocket_energy_kj: float | None  # gas pocket at the highest test pressure (real gas, isentropic)
    liquid_energy_kj: float | None  # liquid in the tank at that pressure, for comparison
    notes: list[NoteOut]
