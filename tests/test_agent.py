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
    assert {s["name"] for s in A.subagents(None)} == {"search", "geometry", "verifier", "outreach"}


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


def test_interrupt_registers_a_live_approval(data, monkeypatch):
    from agent import approvals
    approvals.clear()
    calls = []
    monkeypatch.setattr(A, "resume", lambda thread, approved: calls.append(approved) or {"status": "queued"})
    r = A.Run("run_i")
    it = SimpleNamespace(value={"action_requests": [{"name": "send_message", "args": {"to": "Leasing", "text": "Hi"}}]})
    ev = r.from_interrupt(it, {"configurable": {"thread_id": "run_i"}})[0]
    assert ev["type"] == "approval_needed" and ev["draft"].startswith(A.AI_DISCLOSURE)
    assert calls == []                                                                 # nothing runs before approval
    assert approvals.resolve(ev["action_id"], True)["status"] == "queued" and calls == [True]


def test_not_configured_without_model_env(monkeypatch):
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert A.configured() is False
