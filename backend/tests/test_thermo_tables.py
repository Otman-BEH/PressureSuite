"""The bicubic tables are only used where they agree with HEOS; everything else falls back to HEOS."""

import CoolProp.CoolProp as CP
import pytest

from pressuresuite.thermo import Fluid


@pytest.mark.parametrize("fluid", ["Nitrogen", "Helium"])
def test_warm_gas_flashes_match_heos(fluid):
    fast, exact = Fluid(fluid), Fluid(fluid, tabular="")
    for P in (1e5, 50e5, 300e5, 900e5):
        for T in (260.0, 400.0, 700.0):
            st = exact.at_PT(P, T)
            assert fast.at_PT(P, T).h == pytest.approx(st.h, rel=1e-5)
            assert fast.at_Ph(st.h, P, T_hint=T).T == pytest.approx(T, rel=1e-5)
            assert fast.h_Ps(P, st.s, T_hint=T) == pytest.approx(st.h, rel=1e-5)


def test_cold_gas_bypasses_the_tables():
    # Where the tables are wrong (helium below ~60 K at high pressure, nitrogen near its dome), results stay exact.
    he, he_exact = Fluid("Helium"), Fluid("Helium", tabular="")
    st = he_exact.at_PT(300e5, 40.0)
    assert he.at_Ph(st.h, 300e5, T_hint=40.0).T == pytest.approx(40.0, rel=1e-9)
    assert he.at_PT(300e5, 40.0).h == pytest.approx(st.h, rel=1e-12)
    n2 = Fluid("Nitrogen")
    ref = CP.AbstractState("HEOS", "Nitrogen")
    ref.update(CP.PT_INPUTS, 1.2e5, 85.0)  # just above the 1.2 bar boiling point
    assert n2.at_PT(1.2e5, 85.0).h == pytest.approx(ref.hmass(), rel=1e-12)
