"""Stored Energy: energy released by a pressurised gas or liquid vessel, TNT and other equivalents."""

from fastapi import APIRouter

from ... import fluids
from ...config import COOLPROP_BACKEND, k_to_c
from ...stored_energy.calculate import stored_energy
from ...stored_energy.models import FluidMeta, StoredEnergyMeta, StoredEnergyRequest, StoredEnergyResponse
from ...stored_energy.physics import TNT_J_PER_KG
from ...thermo import coolprop_version

router = APIRouter(prefix="/api/stored-energy", tags=["Stored Energy"])


@router.get("/meta", response_model=StoredEnergyMeta)
def meta() -> StoredEnergyMeta:
    """Fluids with their valid ranges, the gauge reference and the TNT factor."""
    out = []
    for name, label in fluids.FLUID_LABELS.items():
        lim = fluids.limits(name)
        out.append(FluidMeta(name=name, label=label, temp_min_c=k_to_c(lim.T_min), temp_max_c=k_to_c(lim.T_max),
                             pressure_max_barg=fluids.pa_to_barg(lim.P_max)))
    return StoredEnergyMeta(coolprop_version=coolprop_version(), backend=COOLPROP_BACKEND,
                            gauge_reference_bara=fluids.P_GAUGE_REF / 1e5, tnt_mj_per_kg=TNT_J_PER_KG / 1e6, fluids=out)


@router.post("/calculate", response_model=StoredEnergyResponse)
def calculate(req: StoredEnergyRequest) -> StoredEnergyResponse:
    return stored_energy(req)
