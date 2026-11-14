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
    ex = json.loads((ROOT / "contracts/units_list.example.json").read_text())
    (tmp_path / "batch/index.json").write_text(json.dumps({"chair_in": [27.0, 42.0], "units": ex["units"]}))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_send_message_is_gated_and_only_the_orchestrator_has_it():
    assert A.INTERRUPT_ON["send_message"]["allowed_decisions"] == ["approve", "reject"]
    assert A.send_message in A.ORCHESTRATOR_TOOLS
    for sub in A.subagents(model=None):
        assert A.send_message not in sub["tools"], sub["name"]
    assert {s["name"] for s in A.subagents(None)} == {"search", "geometry", "verifier", "outside", "outreach", "general-purpose"}


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
    r.calls["c2"] = ("task", {"subagent_type": "verifier"})
    ev = r.from_tool(SimpleNamespace(tool_call_id="c2", name="", content="checked"))[0]
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
