"""Turns a stored energy request into physics calls and reports the result."""

from __future__ import annotations

from .. import fluids
from ..notes import NoteOut, assumption, critical, note
from ..config import c_to_k, k_to_c
from .models import EquivalentOut, GasOut, LiquidOut, StoredEnergyRequest, StoredEnergyResponse, TntOut, WallIn
from .physics import (
    CAR_J,
    CAR_REFERENCE,
    GRENADE_J,
    GRENADE_REFERENCE,
    TNT_J_PER_KG,
    Wall,
    gas_energy,
    liquid_energy,
    real_isentropic_energy,
    tnt_mass,
)

P_AMBIENT = fluids.P_GAUGE_REF  # the contents always expand to 1 bar a


def to_wall(w: WallIn) -> Wall:
    return Wall(shape=w.shape, D=w.inner_diameter_mm / 1e3, t=w.thickness_mm / 1e3, E=w.youngs_modulus_gpa * 1e9, nu=w.poisson)


def stored_energy(req: StoredEnergyRequest) -> StoredEnergyResponse:
    P, T, Pa, V = fluids.barg_to_pa(req.pressure_barg), c_to_k(req.temp_c), P_AMBIENT, req.volume_l / 1e3
    st = fluids.state_PT(req.fluid, P, T)
    notes: list[NoteOut] = []
    gas_out = liquid_out = None

    if st.phase == "gas":
        g = gas_energy(req.fluid, P, T, Pa, V)
        energy = g.real_j
        method = "Isentropic expansion to 1 bar a, real gas (CoolProp)"
        gas_out = GasOut(real_isentropic_kj=g.real_j / 1e3, real_expansion_work_kj=g.real_expansion_work_j / 1e3,
                         ideal_brode_kj=g.brode_j / 1e3, ideal_isentropic_kj=g.ideal_isentropic_j / 1e3, gamma=g.gamma,
                         compressibility_z=g.Z, end_temp_c=k_to_c(g.end_T), end_quality=g.end_quality)
        if g.end_quality is not None:
            notes.append(note(f"The isentropic expansion ends inside the two-phase region (vapour fraction "
                              f"{g.end_quality:.2f}); the ideal-gas values do not apply there."))
        if req.wall is not None:
            notes.append(assumption("Wall strain energy is only added for liquids; it is negligible next to the gas energy."))
    elif st.phase == "liquid":
        wall = to_wall(req.wall) if req.wall else None
        liq = liquid_energy(req.fluid, P, T, Pa, V, wall)
        energy = liq.total_j
        method = "Liquid compressibility, E = p²V / (2K)"
        T_boil = fluids.saturation_T(req.fluid, Pa)
        flashes = T_boil is not None and T > T_boil
        try:
            isentropic = real_isentropic_energy(req.fluid, P, T, Pa, V)[0]
        except ValueError:
            isentropic = None
        liquid_out = LiquidOut(fluid_kj=liq.fluid_j / 1e3, wall_kj=None if liq.wall_j is None else liq.wall_j / 1e3,
                               total_kj=liq.total_j / 1e3, bulk_modulus_mpa=liq.bulk_modulus_pa / 1e6, flashes=flashes,
                               isentropic_kj=None if isentropic is None else isentropic / 1e3)
        if wall is None:
            notes.append(assumption("Vessel wall strain energy not included (no wall material and geometry given)."))
        if flashes:
            see = (f" Isentropic expansion to 1 bar a gives {isentropic / 1e3:.4g} kJ." if isentropic is not None
                   else " CoolProp cannot follow the expansion to 1 bar a (it would leave the fluid's range, e.g. to a solid).")
            notes.append(critical(f"{req.fluid} is above its boiling point at 1 bar a ({k_to_c(T_boil):.1f} °C): on a "
                                  "burst it flashes to vapour and releases far more than the compressibility energy." + see))
    else:
        raise ValueError(f"{req.fluid} is two-phase at this state; enter a single-phase state.")

    return StoredEnergyResponse(
        fluid=req.fluid, phase=st.phase, method=method, pressure_barg=req.pressure_barg, pressure_bara=P / 1e5,
        temp_c=req.temp_c, density_kg_m3=st.rho, mass_kg=st.rho * V, energy_kj=energy / 1e3,
        gas=gas_out, liquid=liquid_out, tnt=TntOut(factor_mj_per_kg=TNT_J_PER_KG / 1e6, tnt_kg=tnt_mass(energy)),
        equivalents=[EquivalentOut(name="Hand grenade", unit_kj=GRENADE_J / 1e3, count=energy / GRENADE_J,
                                   reference=GRENADE_REFERENCE),
                     EquivalentOut(name="Car crash at 100 km/h", unit_kj=CAR_J / 1e3, count=energy / CAR_J,
                                   reference=CAR_REFERENCE)],
        notes=notes,
    )
