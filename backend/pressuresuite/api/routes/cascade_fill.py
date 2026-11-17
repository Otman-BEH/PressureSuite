"""COPV Cascade Fill: simulate, optimise and plan cascade fills of a COPV from gas bundles and bottles."""

from fastapi import APIRouter

from ...cascade_fill.campaign import campaign
from ...cascade_fill.defaults import FLUID_DEFAULT_PRESSURE_BARG, T_SOURCE_REF
from ...cascade_fill.engine import _chiller_work, compress, exchange
from ...cascade_fill.models import (
    CampaignRequest,
    CampaignResponse,
    FluidInfo,
    HeatExchangerIn,
    HeatExchangerPreviewRequest,
    HeatExchangerPreviewResponse,
    MachinePreviewRequest,
    MachinePreviewResponse,
    MetaResponse,
    OptimizeRequest,
    OptimizeResponse,
    SimulateRequest,
    SimulateResponse,
)
from ...cascade_fill.optimizer import optimize
from ...cascade_fill.simulate import simulate, to_exchanger, to_machine
from ...config import COOLPROP_BACKEND, barg_to_pa, c_to_k, k_to_c, pa_to_barg
from ...thermo import coolprop_version, eos_reference, get_fluid

router = APIRouter(prefix="/api/cascade-fill", tags=["COPV Cascade Fill"])


@router.get("/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    """CoolProp version and the gases this tool offers, for the footer and default pressures."""
    return MetaResponse(
        coolprop_version=coolprop_version(),
        backend=COOLPROP_BACKEND,
        source_ref_temp_c=k_to_c(T_SOURCE_REF),
        fluids=[FluidInfo(name=name, eos=eos_reference(name), default_pressure_barg=p)
                for name, p in FLUID_DEFAULT_PRESSURE_BARG.items()],
    )


@router.post("/simulate", response_model=SimulateResponse)
def simulate_endpoint(req: SimulateRequest) -> SimulateResponse:
    return simulate(req)


@router.post("/optimize", response_model=OptimizeResponse)
def optimize_endpoint(req: OptimizeRequest) -> OptimizeResponse:
    return optimize(req)


@router.post("/campaign", response_model=CampaignResponse)
def campaign_endpoint(req: CampaignRequest) -> CampaignResponse:
    return campaign(req)


@router.post("/heat-exchanger/preview", response_model=HeatExchangerPreviewResponse)
def heat_exchanger_preview(req: HeatExchangerPreviewRequest) -> HeatExchangerPreviewResponse:
    """Outlet temperature and heat removed for gas entering at one temperature and pressure."""
    f, T0 = get_fluid(req.fluid), c_to_k(req.ambient_temp_c)
    hx = to_exchanger(HeatExchangerIn(**{**req.exchanger.model_dump(), "installed": True}))
    P = barg_to_pa(req.pressure_barg)
    h_in = f.at_PT(P, c_to_k(req.inlet_temp_c)).h
    h_out, T_out, _ = exchange(f, hx, h_in, P)
    q = h_in - h_out
    return HeatExchangerPreviewResponse(outlet_temp_c=k_to_c(T_out), duty_kj_per_kg=q / 1e3,
                                        chiller_kj_per_kg=_chiller_work(T0, q, hx.sink_T(T_out)) / 1e3)


@router.post("/machine/preview", response_model=MachinePreviewResponse)
def machine_preview(req: MachinePreviewRequest) -> MachinePreviewResponse:
    """Outlet gas temperature and work for one inlet/outlet pressure pair."""
    f, T0, spec = get_fluid(req.fluid), c_to_k(req.ambient_temp_c), req.machine
    mc = to_machine(spec)
    feed = f.at_PT(barg_to_pa(req.inlet_barg), T0)
    P_out = barg_to_pa(req.outlet_barg)
    h_out, w, T_out, P_in = compress(f, T0, mc, feed, P_out)
    ratio = max(P_out / P_in, 1.0)
    notes, runs = [], True
    if req.inlet_barg < spec.inlet_min_barg:
        notes.append(f"Inlet is below the minimum ({spec.inlet_min_barg:g} barg): the machine stops.")
        runs = False
    if req.inlet_barg > spec.inlet_max_barg:
        notes.append(f"The inlet regulator throttles the feed to {spec.inlet_max_barg:g} barg first.")
    if req.outlet_barg > spec.outlet_max_barg:
        notes.append(f"Outlet is above the maximum ({spec.outlet_max_barg:g} barg): the machine stalls before this.")
        runs = False
    if ratio > spec.max_ratio:
        notes.append(f"Pressure ratio {ratio:.1f}:1 is above the limit ({spec.max_ratio:g}:1).")
        runs = False
    if P_out <= P_in:
        notes.append("Outlet is below the inlet: gas flows straight through without compression.")
    return MachinePreviewResponse(outlet_temp_c=k_to_c(T_out), work_kj_per_kg=w / 1e3, ratio=ratio,
                                  inlet_used_barg=pa_to_barg(P_in), runs=runs, notes=notes)
