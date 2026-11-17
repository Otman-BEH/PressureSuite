import pytest

from pressuresuite.cascade_fill.models import AfterTestIn, CopvIn, SequenceItem, Settings, SimulateRequest, SourceIn, TimeModelIn
from pressuresuite.cascade_fill.simulate import simulate


def bundle(sid, p, rated=300.0, count=12):
    return SourceIn(id=sid, kind="bundle", fluid="Nitrogen", pressure_barg=p, cylinder_volume_l=50,
                    cylinder_count=count, rated_barg=rated)


def run(sources, sequence, *, mode="isothermal", target=180.0, time=None, after=None):
    return simulate(SimulateRequest(
        settings=Settings(mode=mode), copv=CopvIn(fluid="Nitrogen", volume_l=50, target_barg=target, initial_barg=0),
        sources=sources, sequence=sequence, time_model=time or TimeModelIn(), after_test=after or AfterTestIn(),
    ))


def step(kind, sid, *, into=None, stop=None, machine=None):
    return SequenceItem(type=kind, source_id=sid, target_id=into, stop_barg=stop, machine=machine)


BOOST_C = [
    step("pump", "a", into="c", stop=250, machine="booster"),  # capped at c's 200 barg rating
    step("pump", "b", into="c", stop=250, machine="booster"),
    step("source", "c"),
]


def three_bundles():
    return [bundle("a", 150), bundle("b", 150), bundle("c", 50, rated=200)]


def test_boost_two_bundles_into_a_third_then_fill_the_copv():
    res = run(three_bundles(), BOOST_C)
    first, second, fill = res.steps
    # a runs down to the booster's minimum inlet before c is full, b tops c up to its rating
    assert (first.target_id, first.status) == ("c", "inlet_limit")
    assert (second.status, second.target_after.pressure_barg) == ("filled", pytest.approx(200, abs=1e-3))
    assert first.copv_after.mass_kg == first.copv_before.mass_kg  # the COPV is untouched while filling c
    assert fill.status == "target_reached" and res.summary.target_reached
    a, b, c = res.sources
    assert a.used_kg + b.used_kg == pytest.approx(first.delivered_kg + second.delivered_kg, rel=1e-9)
    assert -c.used_kg + res.summary.delivered_kg == pytest.approx(first.delivered_kg + second.delivered_kg, rel=1e-6)


def test_hot_boosted_bundle_needs_a_cooldown_to_take_more():
    res = run(three_bundles(), BOOST_C, mode="adiabatic")
    first, second, _ = res.steps
    assert first.status == "filled" and first.target_after.temp_c > 40  # no aftercooler: c fills up hot
    assert second.status == "no_flow" and "stop pressure" in second.message
    cooled = run(three_bundles(), [BOOST_C[0], SequenceItem(type="cooldown"), BOOST_C[1]], mode="adiabatic")
    assert cooled.steps[2].status == "filled" and cooled.steps[2].delivered_kg > 1


def test_valve_into_a_bundle_stops_at_the_requested_pressure():
    res = run([bundle("a", 300), bundle("c", 0)], [step("source", "a", into="c", stop=100)])
    st = res.steps[0]
    assert st.status == "filled" and st.target_after.pressure_barg == pytest.approx(100, abs=1e-3)


def test_recovery_respects_the_bundle_rating():
    sources = [bundle("a", 300), bundle("rec", 0, rated=5, count=1)]
    res = run(sources, [step("source", "a")], after=AfterTestIn(action="recover", vessel_id="rec"))
    rec_steps = [s for s in res.steps if s.type == "recovery"]
    assert rec_steps[0].status == "filled"
    assert rec_steps[0].source_after.pressure_barg == pytest.approx(5, abs=1e-3)


def test_timeline_covers_fill_settle_and_hold():
    sources = [bundle("a", 150), bundle("b", 300)]
    seq = [step("source", "a"), step("source", "b")]
    untimed = run(sources, seq, mode="adiabatic")
    tl = untimed.timeline
    assert tl[0].phase == "Start" and all(p.t_min is None for p in tl)
    assert [p.progress for p in tl] == sorted(p.progress for p in tl)
    assert {"Settling"} <= {p.phase for p in tl}
    assert tl[-1].copv_temp_c == pytest.approx(20, abs=1e-6)  # settled
    assert set(tl[0].vessels) == {"a", "b"}

    timed = run(sources, seq, mode="adiabatic", time=TimeModelIn(enabled=True, hold_min=10))
    t = timed.timeline
    assert all(p.t_min is not None for p in t)
    assert [p.t_min for p in t] == sorted(p.t_min for p in t)
    assert t[-1].t_min == pytest.approx(timed.summary.time.total_min, rel=1e-6)
    peak = max(p.copv_temp_c for p in t)
    assert peak == pytest.approx(timed.summary.peak_gas_temp_c, abs=0.5)
    # Bundle a drops during step 1 and stays put afterwards.
    a_end = timed.steps[0].source_after.pressure_barg
    assert any(abs(p.vessels["a"] - a_end) < 1e-6 for p in t if p.phase.startswith("2."))


def test_parallel_copvs_split_the_gas_equally():
    from pressuresuite.cascade_fill.models import CampaignRequest
    from pressuresuite.cascade_fill.campaign import campaign
    sources = [bundle("a", 150), bundle("b", 300)]
    seq = [step("source", "a"), step("source", "b")]
    one = run(sources, seq)
    two = simulate(SimulateRequest(
        settings=Settings(), copv=CopvIn(fluid="Nitrogen", volume_l=50, target_barg=180, initial_barg=0, parallel=2),
        sources=sources, sequence=seq))
    assert two.summary.parallel == 2 and two.summary.target_reached
    assert two.summary.delivered_kg == pytest.approx(2 * one.summary.delivered_kg, rel=1e-9)  # each gets the same
    assert two.summary.copv_settled.pressure_barg == pytest.approx(180, abs=1e-6)
    # the first bundle equalizes lower when it has to fill two COPVs
    assert two.steps[0].copv_after.pressure_barg < one.steps[0].copv_after.pressure_barg
    fc = campaign(CampaignRequest(settings=Settings(), sources=[bundle("x", 300), bundle("y", 300)], count=5,
                                  copv=CopvIn(fluid="Nitrogen", volume_l=50, target_barg=180, initial_barg=0, parallel=2)))
    assert [f.copvs for f in fc.fills] == [2, 2, 1] and fc.completed == 5


def test_a_feed_step_only_connects_its_bundle_to_the_pump():
    seq = [SequenceItem(type="source", source_id="a", feeds_pump=True), step("pump", "a", machine="booster")]
    res = run([bundle("a", 150)], seq)
    feed, boost = res.steps
    assert feed.status == "feeds_pump" and feed.delivered_kg == 0 and "boost pump (step 2)" in feed.message
    assert boost.status == "target_reached"


def test_bundles_on_a_manifold_act_as_one_vessel():
    sources = [bundle("a", 150), bundle("b", 300)]
    res = run(sources, [SequenceItem(type="source", source_id="a", source_ids=["a", "b"])])
    st = res.steps[0]
    assert st.source_ids == ["a", "b"] and st.status == "target_reached"
    a, b = res.sources
    assert a.end.pressure_barg == pytest.approx(b.end.pressure_barg, abs=1e-6)  # one shared header pressure
    assert a.used_kg + b.used_kg == pytest.approx(res.summary.delivered_kg * 1.0, rel=1e-9)
    assert res.summary.sources_opened == 2
    # mixing 150 and 300 barg bundles through the header destroys exergy that a cascade would keep
    cascade = run(sources, [step("source", "a"), step("source", "b")])
    assert res.summary.wasted_exergy_kj > cascade.summary.wasted_exergy_kj


@pytest.mark.parametrize("mode", ["isothermal", "adiabatic"])
def test_boost_to_900_then_rapid_equalisation(mode):
    from pressuresuite.cascade_fill.models import EquipmentIn, default_booster
    booster = default_booster().model_copy(update={"outlet_max_barg": 1000})
    sources = [bundle("a", 250), bundle("b", 250), bundle("hp", 100, rated=1000, count=4)]
    seq = [
        SequenceItem(type="source", source_id="a", source_ids=["a", "b"], feeds_pump=True),
        SequenceItem(type="pump", source_id="a", source_ids=["a", "b"], machine="booster", target_id="hp", stop_barg=900),
        step("source", "hp"),
    ]
    res = simulate(SimulateRequest(
        settings=Settings(mode=mode), copv=CopvIn(fluid="Nitrogen", volume_l=50, target_barg=180, initial_barg=0),
        sources=sources, sequence=seq, equipment=EquipmentIn(booster=booster),
        time_model=TimeModelIn(enabled=True, orifice_mm=4),
    ))
    feed, boost, dump = res.steps
    assert feed.status == "feeds_pump"
    assert boost.status == "filled" and boost.target_after.pressure_barg == pytest.approx(900, abs=1e-3)
    assert boost.source_ids == ["a", "b"]
    assert dump.status == "target_reached" and res.summary.target_reached
    assert dump.duration_min < 1.0  # dumping from 900 barg through a 4 mm valve is quick


@pytest.mark.parametrize("mode", ["isothermal", "adiabatic"])
def test_compressor_feeds_the_boost_pump(mode):
    lp = [bundle("lp", 15, count=24)]  # below the boost pump's 20 barg minimum inlet
    alone = run(lp, [step("pump", "lp", machine="booster")], mode=mode)
    assert (alone.steps[0].status, alone.steps[0].delivered_kg) == ("no_flow", 0)

    seq = [
        SequenceItem(type="pump", source_id="lp", machine="compressor", feeds_pump=True),
        SequenceItem(type="pump", source_id="lp", machine="booster", feed_machines=["compressor"]),
    ]
    res = run(lp, seq, mode=mode, time=TimeModelIn(enabled=True))
    feed, boost = res.steps
    assert feed.status == "feeds_pump" and "series" in feed.message
    assert boost.status == "target_reached" and res.summary.target_reached
    assert boost.feed_machines == ["compressor"] and boost.energy_kwh > 0
    # the compressor's 15 Nm3/h is the slower of the two, so it sets the pace
    rho_n = 1.2504  # N2 at 0 °C, 1.01325 bar
    assert boost.duration_min == pytest.approx(boost.delivered_kg / (15 * rho_n / 60), rel=2e-3)


def test_quantity_is_identical_bundles_opened_together():
    four = SourceIn(id="a", label="Bundle 1", kind="bundle", fluid="Nitrogen", pressure_barg=150, cylinder_volume_l=50,
                    cylinder_count=12, quantity=4)
    big = bundle("a", 150, count=48)
    a, b = run([four], [step("source", "a")]), run([big], [step("source", "a")])
    assert a.steps[0].delivered_kg == pytest.approx(b.steps[0].delivered_kg, rel=1e-9)
    assert a.sources[0].settled_barg == pytest.approx(b.sources[0].settled_barg, rel=1e-9)
    assert any("Bundle 1 ×4" in p.phase for p in a.timeline)  # named as a set of four
