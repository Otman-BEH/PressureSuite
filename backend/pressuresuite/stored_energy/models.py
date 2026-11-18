"""API schemas. Field names carry their units; gauge pressures (barg) are relative to 1 bar a."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..notes import NoteOut

CalcFluid = Literal["Nitrogen", "Helium", "Air", "Argon", "Oxygen", "Hydrogen", "Methane", "CarbonDioxide", "Water", "Ethanol"]


class WallIn(BaseModel):
    """Thin vessel wall, for the elastic strain energy / volumetric expansion. Heads are ignored for a cylinder."""

    shape: Literal["cylinder", "sphere"] = "cylinder"
    inner_diameter_mm: float = Field(gt=0, le=100_000)
    thickness_mm: float = Field(gt=0, le=10_000)
    youngs_modulus_gpa: float = Field(gt=0, le=2_000, description="Steel ~200, aluminium ~70")
    poisson: float = Field(default=0.3, ge=0, lt=0.5)


class StoredEnergyRequest(BaseModel):
    fluid: CalcFluid
    volume_l: float = Field(gt=0, le=1_000_000, description="Internal volume")
    pressure_barg: float = Field(gt=0, le=20_000)
    temp_c: float = Field(default=20.0, ge=-273, le=1_700)
    wall: WallIn | None = Field(default=None, description="Liquid only: adds the wall strain energy")


class GasOut(BaseModel):
    real_isentropic_kj: float  # atmospheric work subtracted (the primary value)
    real_expansion_work_kj: float  # m (u1 - u2s), same basis as ideal_isentropic_kj
    ideal_brode_kj: float
    ideal_isentropic_kj: float
    gamma: float
    compressibility_z: float
    end_temp_c: float
    end_quality: float | None


class LiquidOut(BaseModel):
    fluid_kj: float
    wall_kj: float | None
    total_kj: float
    bulk_modulus_mpa: float
    flashes: bool  # above its boiling point at ambient pressure: flashing energy not covered
    isentropic_kj: float | None  # isentropic expansion to ambient, as a cross-check (and the flashing case)


class TntOut(BaseModel):
    factor_mj_per_kg: float
    tnt_kg: float


class EquivalentOut(BaseModel):
    """The energy expressed as a number of everyday things, for context."""

    name: str
    unit_kj: float  # energy of one
    count: float
    reference: str


class StoredEnergyResponse(BaseModel):
    fluid: str
    phase: Literal["gas", "liquid"]
    method: str
    pressure_barg: float
    pressure_bara: float
    temp_c: float
    density_kg_m3: float
    mass_kg: float
    energy_kj: float
    gas: GasOut | None
    liquid: LiquidOut | None
    tnt: TntOut
    equivalents: list[EquivalentOut]
    notes: list[NoteOut]


class FluidMeta(BaseModel):
    name: str
    label: str
    temp_min_c: float
    temp_max_c: float
    pressure_max_barg: float


class StoredEnergyMeta(BaseModel):
    coolprop_version: str
    backend: str
    gauge_reference_bara: float
    tnt_mj_per_kg: float
    fluids: list[FluidMeta]
