"""Hydrostatic Test: liquid pumped in and returned, stored energy and timing per test cycle, and volume checks."""

from fastapi import APIRouter

from ...hydro_test.calculate import hydro_test, volume_check
from ...hydro_test.models import HydroTestRequest, HydroTestResponse, VolumeCheckRequest, VolumeCheckResponse

router = APIRouter(prefix="/api/hydro-test", tags=["Hydrostatic Test"])


@router.post("/calculate", response_model=HydroTestResponse)
def calculate(req: HydroTestRequest) -> HydroTestResponse:
    return hydro_test(req)


@router.post("/volume-check", response_model=VolumeCheckResponse)
def volume_check_endpoint(req: VolumeCheckRequest) -> VolumeCheckResponse:
    """Tank volume (liquid full) or gas pocket volume from liquid pumped in and returned."""
    return volume_check(req)
