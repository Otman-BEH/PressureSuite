"""API schemas. Field names carry their units; gauge pressures (barg) are relative to 1 bar a."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..notes import NoteOut
from ..stored_energy.models import CalcFluid, WallIn


class LeakRequest(BaseModel):
    """Leak rate from a measured hold: start and end pressure and the hold time."""

    fluid: CalcFluid
    volume_l: float = Field(gt=0, le=1_000_000)
    temp_c: float = Field(default=20.0, ge=-273, le=1_700)
    wall: WallIn | None = None
    start_barg: float = Field(gt=0, le=20_000)
    end_barg: float = Field(ge=0, le=20_000)
    hold_min: float = Field(gt=0, le=1_000_000)


class FlowOut(BaseModel):
    unit: str  # label, e.g. "mL/min"
    value: float


class LeakResponse(BaseModel):
    phase: Literal["gas", "liquid"]
    rate_bar_min: float
    drop_bar: float
    lost_kg: float
    mass_rate_g_min: float
    flows: list[FlowOut]  # the same leak in the usual flow units for this phase
    notes: list[NoteOut]
