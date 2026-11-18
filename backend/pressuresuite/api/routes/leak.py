"""Leak rate: a sidebar calculator shared by the test tabs (not a tab of its own)."""

from fastapi import APIRouter

from ...leak.calculate import leak
from ...leak.models import LeakRequest, LeakResponse

router = APIRouter(prefix="/api/leak", tags=["Leak rate"])


@router.post("/calculate", response_model=LeakResponse)
def calculate(req: LeakRequest) -> LeakResponse:
    return leak(req)
