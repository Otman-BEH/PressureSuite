"""API schemas. Field names carry their units; pressures are gauge (barg)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

FluidName = Literal["Nitrogen", "Helium"]
ModeName = Literal["isothermal", "adiabatic", "adiabatic_wall"]
MachineKind = Literal["booster", "compressor"]
StepStatus = Literal[
    "target_reached", "equalized", "inlet_limit", "outlet_limit", "ratio_limit", "vented", "filled",
    "no_flow", "not_needed", "cooled", "fluid_mismatch", "feeds_pump",
]


class MachineIn(BaseModel):
    """Boost pump or compressor. Pressures are gauge."""

    inlet_min_barg: float = Field(ge=0, le=1000, description="Stops when the feed drops below this")
    inlet_max_barg: float = Field(gt=0, le=1000, description="Higher feed pressure is throttled by a regulator")
    outlet_max_barg: float = Field(gt=0, le=2000, description="Stall / relief pressure")
    max_ratio: float = Field(gt=1, le=1000, description="Max overall outlet/inlet ratio (absolute pressures)")
    stages: int = Field(ge=1, le=8)
    efficiency: float = Field(gt=0.1, le=1, description="Isentropic efficiency per stage")
    intercooled: bool = Field(description="Gas cooled to ambient between stages (no aftercooler)")
    flow_nm3_h: float = Field(gt=0, le=100_000, description="Throughput, used for a time estimate")

    @model_validator(mode="after")
    def _inlet_range(self):
        if self.inlet_max_barg < self.inlet_min_barg:
            raise ValueError("inlet_max_barg must not be below inlet_min_barg")
        return self


def default_booster() -> MachineIn:
    return MachineIn(inlet_min_barg=20, inlet_max_barg=250, outlet_max_barg=400, max_ratio=10, stages=2,
                     efficiency=0.7, intercooled=True, flow_nm3_h=30)


def default_compressor() -> MachineIn:
    return MachineIn(inlet_min_barg=0, inlet_max_barg=10, outlet_max_barg=300, max_ratio=400, stages=4,
                     efficiency=0.7, intercooled=True, flow_nm3_h=15)


class EquipmentIn(BaseModel):
    booster: MachineIn = Field(default_factory=default_booster)
    compressor: MachineIn = Field(default_factory=default_compressor)


class AfterTestIn(BaseModel):
    """What happens to the COPV gas after the test."""

    action: Literal["none", "vent", "recover"] = "none"
    vessel_id: str | None = Field(default=None, description="Recovery bundle (valve first, then the compressor)")
    vent_to_barg: float = Field(default=0.0, ge=0, le=1000)


class HeatExchangerIn(BaseModel):
    """Heat exchanger in the fill line, just before the COPV."""

    installed: bool = False
    control: Literal["outlet_temp", "effectiveness"] = "outlet_temp"
    outlet_temp_c: float = Field(default=20.0, ge=-200, le=300)
    coolant_temp_c: float = Field(default=20.0, ge=-200, le=300)
    effectiveness_pct: float = Field(default=80.0, gt=0, le=100)


class TimeModelIn(BaseModel):
    """Optional time estimate. It does not change temperatures or pressures."""

    enabled: bool = False
    orifice_mm: float = Field(default=2.0, gt=0, le=100, description="Effective valve/line flow diameter")
    max_rate_bar_min: float = Field(default=0.0, ge=0, le=10_000, description="COPV pressure-change limit; 0 = none")
    h_ext_w_m2k: float = Field(default=10.0, gt=0, le=10_000, description="Outside heat-transfer coefficient")
    copv_area_m2: float | None = Field(default=None, gt=0, le=1000, description="Outer surface; estimated if omitted")
    settle_tolerance_k: float = Field(default=2.0, gt=0, le=100)
    connection_min: float = Field(default=3.0, ge=0, le=1000, description="Hook-up/purge time per connection")
    hold_min: float = Field(default=10.0, ge=0, le=10_000, description="Test hold time per COPV")


class SourceIn(BaseModel):
    id: str
    label: str = ""
    kind: Literal["bundle", "bottle"]
    fluid: FluidName
    pressure_barg: float = Field(ge=0, le=1000, description="Pressure at the 20 °C reference temperature")
    cylinder_volume_l: float = Field(gt=0, le=10_000)
    cylinder_count: int = Field(ge=1, le=500)
    rated_barg: float | None = Field(default=None, gt=0, le=1000, description="Max pressure when it is being filled")
    quantity: int = Field(default=1, ge=1, le=100, description="Identical units, always at the same pressure and opened together")

    @property
    def volume_m3(self) -> float:
        return self.cylinder_volume_l * self.cylinder_count * self.quantity / 1000


class CopvIn(BaseModel):
    fluid: FluidName
    volume_l: float = Field(gt=0, le=100_000)
    target_barg: float = Field(gt=0, le=1000, description="Settled pressure at ambient temperature")
    initial_barg: float = Field(ge=0, le=1000, description="Starting pressure at ambient temperature")
    wall_mass_kg: float = Field(default=25.0, ge=0, le=100_000)
    wall_cp_j_kgk: float = Field(default=900.0, gt=0, le=10_000)
    leak_pct: float = Field(default=0.0, ge=0, le=50, description="Extra gas lost per fill, % of what reaches the COPV")
    parallel: int = Field(default=1, ge=1, le=50, description="Identical COPVs on the manifold, filled together (equal split)")


class Settings(BaseModel):
    ambient_temp_c: float = Field(default=20.0, ge=-60, le=80)
    mode: ModeName = "isothermal"


class SequenceItem(BaseModel):
    type: Literal["source", "cooldown", "pump"]
    source_id: str | None = None
    source_ids: list[str] | None = Field(default=None, description="Bundles opened together on a manifold")
    machine: MachineKind | None = None  # for pump steps
    target_id: str | None = None  # receiving bundle; None = the COPV
    stop_barg: float | None = Field(default=None, gt=0, le=1000, description="Stop filling the bundle at this pressure")
    feeds_pump: bool = Field(default=False, description="Step that only connects its source (or machine) to a later pump step")
    feed_machines: list[MachineKind] | None = Field(
        default=None, description="Pump steps: machines in series upstream of `machine`, the first drawing from the source")


class SimulateRequest(BaseModel):
    settings: Settings
    copv: CopvIn
    sources: list[SourceIn]
    sequence: list[SequenceItem]
    equipment: EquipmentIn = Field(default_factory=EquipmentIn)
    heat_exchanger: HeatExchangerIn = Field(default_factory=HeatExchangerIn)
    after_test: AfterTestIn = Field(default_factory=AfterTestIn)
    time_model: TimeModelIn = Field(default_factory=TimeModelIn)


class OptimizeRequest(BaseModel):
    settings: Settings
    copv: CopvIn
    sources: list[SourceIn]
    heat_exchanger: HeatExchangerIn = Field(default_factory=HeatExchangerIn)
    source_ids: list[str] | None = Field(default=None, description="Subset of the pool to use; all if omitted")
    min_gain_bar: float = Field(default=10.0, ge=0, le=500)
    max_cooldowns: int = Field(default=4, ge=0, le=10)


class CampaignRequest(OptimizeRequest):
    count: int = Field(ge=1, le=50, description="COPVs still to fill")
    equipment: EquipmentIn = Field(default_factory=EquipmentIn)
    after_test: AfterTestIn = Field(default_factory=AfterTestIn)
    time_model: TimeModelIn = Field(default_factory=TimeModelIn)


class HeatExchangerPreviewRequest(BaseModel):
    fluid: FluidName
    ambient_temp_c: float = Field(default=20.0, ge=-60, le=80)
    exchanger: HeatExchangerIn
    inlet_temp_c: float = Field(ge=-200, le=1000)
    pressure_barg: float = Field(ge=0, le=1000)


class MachinePreviewRequest(BaseModel):
    fluid: FluidName
    ambient_temp_c: float = Field(default=20.0, ge=-60, le=80)
    machine: MachineIn
    inlet_barg: float = Field(ge=0, le=1000)
    outlet_barg: float = Field(ge=0, le=2000)


class VesselView(BaseModel):
    pressure_barg: float
    temp_c: float  # gas temperature
    mass_kg: float


class StepOut(BaseModel):
    index: int
    type: Literal["source", "cooldown", "pump", "recovery", "vent"]
    source_id: str | None
    source_ids: list[str] | None = None  # manifold: all bundles opened together (source_* views are their combination)
    machine: MachineKind | None = None
    feed_machines: list[MachineKind] | None = None  # machines in series upstream of `machine`
    status: StepStatus
    message: str
    delivered_kg: float  # into the COPV (into the bundle when recovering, to air when venting)
    leaked_kg: float = 0.0
    settled_gain_bar: float
    wasted_exergy_kj: float
    energy_kwh: float = 0.0  # machine work
    outlet_temp_max_c: float | None = None  # hottest machine discharge
    hx_duty_kwh: float = 0.0  # heat removed by the fill-line heat exchanger
    hx_outlet_min_c: float | None = None
    hx_outlet_max_c: float | None = None
    duration_min: float | None = None  # time estimate (machines: at rated flow)
    copv_before: VesselView
    copv_after: VesselView
    source_before: VesselView | None = None
    source_after: VesselView | None = None
    target_id: str | None = None  # receiving bundle (bundle fills and recovery)
    target_before: VesselView | None = None
    target_after: VesselView | None = None


class TracePointOut(BaseModel):
    step: int
    delivered_kg: float  # cumulative into the COPV
    copv_barg: float
    copv_temp_c: float
    copv_settled_barg: float
    source_barg: float | None


class SourceResult(BaseModel):
    id: str
    start: VesselView
    end: VesselView
    settled_barg: float  # end-of-fill mass at ambient temperature
    pressure_ref_barg: float  # end-of-fill mass at the 20 °C reference (carry-over value)
    used_kg: float
    connections: int


class TimeBreakdown(BaseModel):
    """Minutes per COPV, when the time model is on."""

    handling_min: float  # connections x hook-up time
    fill_min: float  # all fill steps, including cool-downs
    settle_min: float  # cooling to ambient after the fill, before the test reading
    hold_min: float
    after_test_min: float  # venting or recovery
    total_min: float
    copv_area_m2: float


class Summary(BaseModel):
    target_barg: float
    target_reached: bool
    shortfall_bar: float
    copv_end: VesselView  # right after the last step (may be hot)
    copv_settled: VesselView  # after cooling to ambient
    peak_gas_temp_c: float
    peak_pressure_barg: float
    delivered_kg: float
    wasted_exergy_kj: float  # includes the final cool-down
    sources_opened: int
    connections: int
    cooldowns: int
    leaked_kg: float = 0.0
    pump_energy_kwh: float = 0.0
    pump_time_min: float = 0.0
    recovered_kg: float = 0.0
    recovery_energy_kwh: float = 0.0
    recovery_time_min: float = 0.0
    vented_kg: float = 0.0
    copv_after_test: VesselView | None = None  # after venting or recovery
    hx_duty_kwh: float = 0.0
    hx_chiller_kwh: float = 0.0  # minimum (Carnot) chiller work
    time: TimeBreakdown | None = None
    parallel: int = 1  # COPVs filled together; masses above are totals over all of them


class TimelinePoint(BaseModel):
    """State of every vessel along the whole cycle (fill, settling, hold, vent/recovery)."""

    t_min: float | None  # with the time estimate on
    progress: float  # step-based position: step k spans [k-1, k]
    phase: str
    copv_barg: float
    copv_temp_c: float
    vessels: dict[str, float]  # source id -> barg


class SimulateResponse(BaseModel):
    steps: list[StepOut]
    trace: list[TracePointOut]
    timeline: list[TimelinePoint]
    summary: Summary
    sources: list[SourceResult]
    warnings: list[str]


class PlanOut(BaseModel):
    sequence: list[SequenceItem]
    summary: Summary
    meets_min_gain: bool


class OptimizeResponse(BaseModel):
    best: PlanOut | None
    alternatives: list[PlanOut]
    feasible: bool
    search_complete: bool
    evaluated_steps: int
    message: str


class PoolLevel(BaseModel):
    id: str
    pressure_ref_barg: float
    mass_kg: float


class CampaignFill(BaseModel):
    index: int  # 1 = the next fill
    copvs: int = 1  # COPVs filled together in this fill
    feasible: bool
    sequence: list[SequenceItem]
    summary: Summary | None
    pool_after: list[PoolLevel]
    message: str


class CampaignResponse(BaseModel):
    count: int
    completed: int
    pool_start_kg: float
    fills: list[CampaignFill]
    total_time_min: float | None = None
    message: str


class HeatExchangerPreviewResponse(BaseModel):
    outlet_temp_c: float
    duty_kj_per_kg: float  # heat removed (negative: added)
    chiller_kj_per_kg: float  # minimum chiller work


class MachinePreviewResponse(BaseModel):
    outlet_temp_c: float
    work_kj_per_kg: float
    ratio: float
    inlet_used_barg: float
    runs: bool
    notes: list[str]


class FluidInfo(BaseModel):
    name: FluidName
    eos: str
    default_pressure_barg: float


class MetaResponse(BaseModel):
    coolprop_version: str
    backend: str
    source_ref_temp_c: float
    fluids: list[FluidInfo]
