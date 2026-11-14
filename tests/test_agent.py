"""Agent wiring, tools and event mapping, without calling a model."""
import json
import pathlib
import shutil
from types import SimpleNamespace

import pytest

from agent import agent as A
from tests.test_contracts import BASIS, EVENT_TYPES, _numbers_have_basis

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def data(tmp_path, monkeypatch):
    (tmp_path / "cache").mkdir()
    (tmp_path / "batch").mkdir()
    shutil.copy(ROOT / "tests/synthetic_demo.json", tmp_path / "cache/synthetic_demo.json")
    shutil.copy(ROOT / "tests/synthetic_1br.json", tmp_path / "cache/synthetic_1br.json")
    ex = json.loads((ROOT / "contracts/units_list.example.json").read_text())
    (tmp_path / "batch/index.json").write_text(json.dumps({"chair_in": [27.0, 42.0], "units": ex["units"]}))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_send_message_is_gated_and_only_the_orchestrator_has_it():
    assert A.INTERRUPT_ON["send_message"]["allowed_decisions"] == ["approve", "reject"]
    assert A.send_message in A.ORCHESTRATOR_TOOLS
    for sub in A.subagents(model=None):
        assert A.send_message not in sub["tools"], sub["name"]
    assert {s["name"] for s in A.subagents(None)} == {"search", "geometry", "outside", "outreach", "general-purpose"}


def test_every_outbound_text_identifies_as_ai(data):
    assert A.with_ai_disclosure("Hello").startswith(A.AI_DISCLOSURE)
    assert A.with_ai_disclosure(A.with_ai_disclosure("Hello")) == A.with_ai_disclosure("Hello")
    draft = A.draft_landlord_message("synthetic_demo", ["Is the entrance step-free?"])
    assert draft["text"].startswith("Hi, this is an AI assistant")
    sent = A.send_message("Leasing office", "Can you widen the door?")
    assert "not delivered" in sent["status"]
    queued = json.loads(next((data / "outbox").glob("*.json")).read_text())
    assert queued["text"].startswith(A.AI_DISCLOSURE)


def test_tools_read_local_data(data):
    s = A.search_units(radius_km=8, top=5)
    assert s["candidates"] == 2 and {u["sid"] for u in s["units"]} == {"synthetic_demo", "synthetic_1br"}
    assert A.search_units(radius_km=0.01)["candidates"] == 0
    fit = A.run_fit("synthetic_demo")
    bed = next(r for r in fit["rooms"] if r["label"] == "Bedroom")
    assert bed["status"] == "blocked" and bed["blocking_door"]["width_in"] == 28.0
    assert next(r for r in A.run_fit("synthetic_demo", hinges=True)["rooms"] if r["label"] == "Bedroom")["status"] == "reachable"
    assert A.run_fit("nope")["error"] == "model not cached"


def _tool_msg(call_id, payload):
    return SimpleNamespace(tool_call_id=call_id, name="", content=json.dumps(payload))


def test_events_follow_the_contract(data):
    r = A.Run("run_t")
    events = [r.ev("plan", text="p", source="orchestrator", todos=[])]
    ai = SimpleNamespace(tool_calls=[{"id": "c1", "name": "run_fit", "args": {"sid": "synthetic_demo", "chair_width_in": 27}},
                                     {"id": "c2", "name": "ls", "args": {"path": "/"}}])
    events += r.from_ai(ai, ())
    assert [e["name"] for e in events if e["type"] == "tool"] == ["run_fit"]          # file tools are not shown
    events += r.from_tool(_tool_msg("c1", A.run_fit("synthetic_demo")))
    events += r.from_tool(_tool_msg("c1", A.run_fit("synthetic_demo")))              # repeat: no duplicate findings
    findings = [e for e in events if e["type"] == "finding"]
    assert {f["room"] for f in findings} == {"Bedroom", "Bathroom", "Closet"} and len(findings) == 3
    bed = next(f for f in findings if f["room"] == "Bedroom")
    assert bed["numbers"]["shortfall"] == {"value": 1.0, "basis": "estimated", "unit": "in"}
    assert bed["numbers"]["blocking_door_width"]["basis"] == "measured"
    fin = r.final("")
    assert fin["shortlist"][0]["sid"] == "synthetic_demo" and "Checked 1 units" in fin["text"]
    for e in events + [fin]:
        assert {"id", "ts", "run_id", "type"} <= set(e) and e["type"] in EVENT_TYPES
        _numbers_have_basis(e, e["id"])
    for f in findings:                                   # UI renders each numbers entry as one Num
        assert all(isinstance(v, dict) and "value" in v and "basis" in v for v in f["numbers"].values())


def test_interrupt_registers_a_live_approval(data, monkeypatch):
    from agent import approvals
    approvals.clear()
    calls = []
    monkeypatch.setattr(A, "resume", lambda thread, approved, *rest: calls.append(approved) or {"status": "queued"})
    r = A.Run("run_i")
    it = SimpleNamespace(value={"action_requests": [{"name": "send_message", "args": {"to": "Leasing", "text": "Hi"}}]})
    ev = r.from_interrupt(it, {"configurable": {"thread_id": "run_i"}})[0]
    assert ev["type"] == "approval_needed" and ev["draft"].startswith(A.AI_DISCLOSURE)
    assert calls == []                                                                 # nothing runs before approval
    assert approvals.resolve(ev["action_id"], True)["status"] == "queued" and calls == [True]


def test_not_configured_without_model_env(monkeypatch):
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert A.configured() is False


def test_one_approval_covers_a_batched_interrupt(data, monkeypatch):
    from agent import approvals
    approvals.clear()
    seen = []
    monkeypatch.setattr(A, "resume", lambda thread, approved, n, msgs: seen.append((approved, n, len(msgs))) or {"status": "ok"})
    r = A.Run("run_b")
    it = SimpleNamespace(value={"action_requests": [{"name": "send_message", "args": {"to": "Office A", "text": "a"}},
                                                    {"name": "send_message", "args": {"to": "Office B", "text": "b"}}]})
    evs = r.from_interrupt(it, {"configurable": {"thread_id": "run_b"}})
    assert len(evs) == 1 and len(evs[0]["messages"]) == 2 and "Office B" in evs[0]["draft"]
    approvals.resolve(evs[0]["action_id"], False)
    assert seen == [(False, 2, 2)]                       # one decision per batched request


class _FakeAgent:
    def __init__(self, write=None, fail=False):
        self.write, self.fail, self.cmd = write, fail, None

    def invoke(self, cmd, thread):
        self.cmd = cmd
        if self.write:
            A.send_message(*self.write)
        if self.fail:
            raise TimeoutError("model timed out")
        return {"messages": [SimpleNamespace(content="done")]}


def test_resume_reports_from_the_outbox(data, monkeypatch):
    msgs = [{"to": "Office", "draft": A.with_ai_disclosure("hi")}]
    fake = _FakeAgent(write=("Office", "hi"), fail=True)              # queued, then the model errors
    monkeypatch.setattr(A, "get_agent", lambda: fake)
    res = A.resume({"configurable": {"thread_id": "t"}}, True, 1, msgs)
    assert res["queued"] == 1 and "queued 1 of 1" in res["status"] and "warning" in res
    assert fake.cmd.resume == {"decisions": [{"type": "approve"}]}
    monkeypatch.setattr(A, "get_agent", lambda: _FakeAgent(fail=True))   # errors before queueing: retryable
    with pytest.raises(RuntimeError):
        A.resume({"configurable": {"thread_id": "t"}}, True, 1, msgs)
    monkeypatch.setattr(A, "get_agent", lambda: _FakeAgent())
    assert A.resume({"configurable": {"thread_id": "t"}}, False, 1, msgs)["status"] == "declined: nothing sent"


def test_verify_event_matches_contract(data):
    r = A.Run("run_v")
    r.calls["c1"] = ("run_fit", {"sid": "synthetic_demo"})
    r.from_tool(_tool_msg("c1", A.run_fit("synthetic_demo")))
    ev = r.verify_event()
    assert ev["type"] == "verify" and ev["source"] == "code" and "1 room(s) with no measured door" in ev["text"]
    assert ev["type"] == "verify" and ev["checked"] and all({"claim", "basis"} <= set(c) for c in ev["checked"])
    assert {c["basis"] for c in ev["checked"]} <= BASIS and "unknown" in {c["basis"] for c in ev["checked"]}
    assert any("closet" in q for q in ev["questions"])


def test_no_negative_shortfall_when_a_door_fits():
    res = {"sid": "s", "scenario": "as scanned", "rooms": [{"room_id": "r", "label": "Bedroom", "status": "blocked",
           "reason": "the door from Hall fits, but the route to it is too tight to turn into", "door_widths_in": [32.0],
           "blocking_door": {"edge": "e", "width_in": 32.0, "clear_in_est": 30.0}, "turning_circle_in": None}]}
    f = A.findings_from_fit(res, 27.0)[0]
    assert "shortfall" not in f["numbers"] and f["numbers"]["blocking_door_width"]["value"] == 32.0


def test_aerial_event_and_api(data, monkeypatch):
    from fastapi.testclient import TestClient
    from engine import vexcel
    assert vexcel.square_wkt(29.7, -95.4).startswith("POLYGON((-95.40") and vexcel.key_for(29.7, -95.4) == "aerial_29p70000_m95p40000"
    res = {"lat": 29.7, "lon": -95.4, "clip_m": 80.0, "image": "aerial_x.jpg", "source": "Vexcel ortho (from aerial)",
           "findings": [{"item": "curb_ramps", "question": "q", "answer": "unclear", "note": "n",
                         "basis": "estimated", "label": "from aerial, estimated"}]}
    (data / "cache/aerial_x.jpg").write_bytes(b"\xff\xd8\xff fake jpeg")
    (data / "cache/aerial_x.findings.json").write_text(json.dumps(res))
    (data / "cache/aerial_synthetic_demo.json").write_text(json.dumps(
        {"sid": "synthetic_demo", "image": "aerial_x.jpg", "findings_file": "aerial_x.findings.json"}))
    r = A.Run("run_a")
    r.calls["c9"] = ("aerial_check", {"sid": "synthetic_demo"})
    ev = r.from_tool(_tool_msg("c9", {"sid": "synthetic_demo", **res}))[0]
    assert ev["type"] == "aerial" and ev["label"] == "from aerial, estimated" and ev["image_url"] == "/api/aerial/synthetic_demo"
    assert ev["text"].startswith("From aerial, estimated.") and "curb ramps: unclear" in ev["text"]
    _numbers_have_basis(ev, ev["id"])
    from agent.server import app
    c = TestClient(app)
    img = c.get("/api/aerial/synthetic_demo")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert c.get("/api/aerial/synthetic_demo/findings").json()["findings"][0]["answer"] == "unclear"
    assert c.get("/api/aerial/notThere123").status_code == 404
    assert c.get("/api/aerial/bad-id!").status_code == 400


def test_aerial_failure_is_reported_not_guessed(data, monkeypatch):
    import engine.vexcel as V
    monkeypatch.setattr(V, "aerial_check_unit", lambda sid: (_ for _ in ()).throw(RuntimeError("HTTP 403")))
    assert A.aerial_check("synthetic_demo") == {"sid": "synthetic_demo", "error": "aerial check failed: RuntimeError"}


def test_aerial_error_becomes_a_tool_error_event():
    r = A.Run("run_e")
    r.calls["c1"] = ("aerial_check", {"sid": "x"})
    ev = r.from_tool(_tool_msg("c1", {"sid": "x", "error": "aerial check failed: RuntimeError"}))
    assert len(ev) == 1 and ev[0]["type"] == "tool" and ev[0]["status"] == "error"


def test_unusable_vision_answer_is_not_cached(data, monkeypatch):
    import engine.vexcel as V
    (data / "cache").mkdir(exist_ok=True)
    img = data / "cache" / f"{V.key_for(29.7, -95.4)}.jpg"
    img.write_bytes(b"\xff\xd8\xff fake")
    monkeypatch.setenv("MODEL_PROVIDER", "google")
    monkeypatch.setenv("MODEL_NAME", "x")

    class _Model:
        def invoke(self, msgs):
            return SimpleNamespace(content="I can't analyse this image.")
    import langchain.chat_models as cm
    monkeypatch.setattr(cm, "init_chat_model", lambda *a, **k: _Model())
    with pytest.raises(RuntimeError):
        V.aerial_check(29.7, -95.4)
    assert not img.with_suffix(".findings.json").exists()


def test_check_units_batches_both_scenarios_and_caches(data):
    res = A.check_units(["synthetic_demo", "nope", "synthetic_demo"])
    demo = res["units"][0]
    assert demo["reachable"] == "1/4" and demo["with_hinges"] == "2/4"
    bed = next(p for p in demo["problems"] if p["room"] == "Bedroom")
    assert bed == {"room": "Bedroom", "status": "blocked", "with_hinges": "reachable", "door_in": 28.0, "short_in_est": 1.0}
    assert len(res["units"]) == 1 and res["not_cached"] == ["nope"]          # uncached: listed, never driven
    cached = list((data / "cache" / "fit").glob("synthetic_demo_27x42_*.json"))
    assert len(cached) == 2
    f = data / f"cache/fit/synthetic_demo_27x42_0_v{A.FIT_CACHE_V}.json"
    assert A.run_fit("synthetic_demo") == {k: v for k, v in json.loads(f.read_text()).items() if k != "_key"}
    f.write_text('{"half')                                   # a torn write is recomputed, not raised
    assert A.run_fit("synthetic_demo")["rooms"] and json.loads(f.read_text())["sid"] == "synthetic_demo"
    for i in range(7):
        shutil.copy(ROOT / "tests/synthetic_demo.json", data / f"cache/synth{i}.json")
    many = A.check_units([f"synth{i}" for i in range(7)])
    assert len(many["units"]) == A.MAX_CHECK and many["skipped"] == ["synth6"]


def test_check_units_events_come_from_engine_output(data):
    r = A.Run("run_c")
    r.calls["c1"] = ("check_units", {"sids": ["synthetic_demo"]})
    evs = r.from_tool(_tool_msg("c1", A.check_units(["synthetic_demo"])))
    fits = [e for e in evs if e["type"] == "tool" and e["name"] == "run_fit"]
    assert [e["result"]["scenario"] for e in fits] == ["as scanned", "offset hinges on every door"]
    assert {e["room"] for e in evs if e["type"] == "finding" and e["scenario"] == "as scanned"} == {"Bedroom", "Bathroom", "Closet"}
    assert r.final("")["shortlist"][0]["sid"] == "synthetic_demo"
    verify = [e for e in evs if e["type"] == "verify"]
    assert len(verify) == 1 and evs[-1] is verify[0] and verify[0]["source"] == "code"   # verifier is code, after geometry


def test_search_is_compact_and_includes_named_units(data):
    s = A.search_units(radius_km=0.01, include=["synthetic_demo"])
    assert s["candidates"] == 0 and [u["sid"] for u in s["units"]] == ["synthetic_demo"]
    assert set(s["units"][0]) == {"sid", "name", "km", "reachable", "with_hinges"} and s["chair_in"] == [27.0, 42.0]
    assert A.search_units(beds=1)["candidates"] == A.search_units(beds=[1])["candidates"] == 2


def test_fit_cache_is_keyed_by_content_not_time(data):
    import os
    A.run_fit("synthetic_demo")
    f = data / f"cache/fit/synthetic_demo_27x42_0_v{A.FIT_CACHE_V}.json"
    os.utime(f, (1, 1))                                       # an unzip that keeps old timestamps
    assert json.loads(f.read_text())["_key"] and A.run_fit("synthetic_demo")["rooms"]
    m = data / "cache/synthetic_demo.json"
    m.write_text(m.read_text().replace("Synthetic 1BR (narrow bedroom door)", "Renamed"))
    assert A.run_fit("synthetic_demo")["name"] == "Renamed"   # model changed: recomputed


def test_search_only_offers_units_with_a_cached_model(data):
    (data / "cache/synthetic_1br.json").unlink()
    s = A.search_units(radius_km=8, top=5)
    assert [u["sid"] for u in s["units"]] == ["synthetic_demo"] and s["candidates"] == 1


def test_search_reranks_live_with_the_persons_chair(data):
    batch = A.search_units(radius_km=8, top=5)
    assert batch["ranked_by"].startswith("precomputed batch")
    narrow = A.search_units(radius_km=8, top=5, chair_width_in=24, chair_length_in=40)
    assert narrow["chair_in"] == [24.0, 40.0] and narrow["ranked_by"].startswith("live fit")
    for u in narrow["units"]:                              # counts are this chair's, straight from the engine
        a = A.run_fit(u["sid"], 24.0, 40.0)
        assert u["reachable"] == f"{sum(r['status'] == 'reachable' for r in a['rooms'])}/{len(a['rooms'])}"
    demo = next(u for u in narrow["units"] if u["sid"] == "synthetic_demo")
    assert demo["reachable"] != next(u for u in batch["units"] if u["sid"] == "synthetic_demo")["reachable"]
    token = A._CHAIR.set((24.0, 40.0))                     # tools fall back to the run's chair if the model omits it
    try:
        assert A.check_units(["synthetic_demo"])["chair_in"] == [24.0, 40.0]
        assert A.search_units()["chair_in"] == [24.0, 40.0]
    finally:
        A._CHAIR.reset(token)


def test_parallel_fits_match_inline_fits(data, monkeypatch):
    for i in range(3):
        shutil.copy(ROOT / "tests/synthetic_demo.json", data / f"cache/par{i}.json")
    A._fit_many([f"par{i}" for i in range(3)], 25.0, 40.0)            # > 2 uncached: worker processes
    for i in range(3):
        assert A._fit_cached(f"par{i}", 25.0, 40.0, False) == A.run_fit("synthetic_demo", 25.0, 40.0) | {"sid": f"par{i}"}


def test_shortlist_is_never_empty_when_the_model_skips_geometry(data):
    r = A.Run("run_s")
    assert r.final("")["shortlist"] == [] and "No unit" in r.final("")["text"]
    r = A.Run("run_s2")
    r.calls["c1"] = ("search_units", {})
    r.from_tool(_tool_msg("c1", A.search_units(radius_km=8)))
    evs = r.ensure_shortlist((27.0, 42.0))
    assert evs[0]["name"] == "check_units" and evs[0]["agent"] == "orchestrator" and "in code" in evs[0]["note"]
    fin = r.final("")
    assert fin["shortlist"] and {u["sid"] for u in fin["shortlist"]} <= {"synthetic_demo", "synthetic_1br"}
    assert r.ensure_shortlist((27.0, 42.0)) == []                        # geometry ran: nothing added


def test_draft_adds_the_unknowns_itself(data):
    d = A.draft_landlord_message("synthetic_demo")
    assert "closet door" in d["text"] and A.ENTRANCE_Q in d["text"] and d["text"].startswith("Hi, this is an AI")
    extra = A.draft_landlord_message("synthetic_demo", ["Is there parking?", A.ENTRANCE_Q])
    assert extra["text"].count(A.ENTRANCE_Q) == 1 and "Is there parking?" in extra["text"]


def test_named_uncached_unit_is_reported_not_dropped(data):
    s = A.search_units(radius_km=8, include=["notdownloaded", "synthetic_demo"])
    assert s["not_cached"] == ["notdownloaded"] and "notdownloaded" not in {u["sid"] for u in s["units"]}


def test_fallback_keeps_the_search_filters_and_labels_an_assumed_chair(data):
    r = A.Run("run_f")
    r.calls["c1"] = ("search_units", {})
    r.from_tool(_tool_msg("c1", A.search_units(radius_km=0.01)))          # the person's search matched nothing
    assert r.ensure_shortlist((27.0, 42.0)) == [] and r.final("")["shortlist"] == []
    r = A.Run("run_g")                                                     # no search, no chair given
    ev = r.ensure_shortlist((27.0, 42.0), chair_asked=False)[0]
    assert ev["args"]["chair_width_in"] == {"value": 27.0, "basis": "assumed", "unit": "in"}
    r = A.Run("run_h")
    ev = r.ensure_shortlist((25.0, 40.0))[0]
    assert ev["args"]["chair_width_in"]["basis"] == "asked"
