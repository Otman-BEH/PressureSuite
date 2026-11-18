"""Gas Test: pneumatic acceptance test cycles, gas used, stored energy and supply bundles."""

from typing import get_args

from fastapi import APIRouter

from ...gas_test.calculate import gas_test
from ...gas_test.models import BUNDLE_PRESSURE_BARG, DEFAULT_BUNDLE_PRESSURE_BARG, GasFluid, GasTestMeta, GasTestRequest, GasTestResponse

router = APIRouter(prefix="/api/gas-test", tags=["Gas Test"])


@router.get("/meta", response_model=GasTestMeta)
def meta() -> GasTestMeta:
    """Gases offered and the usual bundle pressure per gas."""
    return GasTestMeta(bundle_pressure_barg=BUNDLE_PRESSURE_BARG, default_bundle_pressure_barg=DEFAULT_BUNDLE_PRESSURE_BARG,
                       fluids=list(get_args(GasFluid)))


@router.post("/calculate", response_model=GasTestResponse)
def calculate(req: GasTestRequest) -> GasTestResponse:
    return gas_test(req)
