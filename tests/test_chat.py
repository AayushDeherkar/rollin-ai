"""POST /api/chat replay stream and POST /api/approve, against the chat events contract."""
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = [json.loads(l) for l in (ROOT / "contracts/chat_events.example.jsonl").read_text().splitlines() if l.strip()]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))         # no recorded run -> synthetic example
    from agent import approvals, chat
    from agent.server import app
    approvals.clear()
    monkeypatch.setattr(chat, "live_runner", None)
    return TestClient(app)


def read_sse(client, url="/api/chat?replay=1&pace=0", body=None):
    events, current = [], {}
    with client.stream("POST", url, json=body or {"message": "27 in chair near TMC"}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("data: "):
                current["data"] = json.loads(line[6:])
            elif line.startswith("event: "):
                current["event"] = line[7:]
            elif line.startswith("id: "):
                current["id"] = line[4:]
            elif line == "" and "data" in current:
                events.append(current)
                current = {}
    return events


def test_replay_streams_every_contract_event_marked_replay(client):
    events = read_sse(client)
    assert [e["data"]["type"] for e in events] == [e["type"] for e in EXAMPLE]
    for e, ex in zip(events, EXAMPLE):
        d = e["data"]
        assert d["replay"] is True and e["event"] == d["type"] and e["id"] == d["id"]
        assert set(ex) <= set(d)                                     # every contract field is still there
        assert d["recorded_ts"] == ex["ts"]
    assert len({e["data"]["run_id"] for e in events}) == 1


def test_replay_approval_is_never_sent(client):
    events = read_sse(client)
    ask = next(e["data"] for e in events if e["data"]["type"] == "approval_needed")
    final = events[-1]["data"]
    assert ask["action_id"] in final["awaiting_approval"]
    r = client.post("/api/approve", json={"action_id": ask["action_id"], "approved": True})
    assert r.status_code == 200 and r.json()["replay"] is True and "not sent" in r.json()["status"]
    assert client.post("/api/approve", json={"action_id": ask["action_id"], "approved": True}).status_code == 409
    assert client.post("/api/approve", json={"action_id": "nope", "approved": True}).status_code == 404


def test_recorded_run_is_preferred(client, tmp_path):
    (tmp_path / "replay").mkdir()
    rec = [{**EXAMPLE[0], "text": "recorded plan"}, EXAMPLE[-1]]
    (tmp_path / "replay/run.jsonl").write_text("".join(json.dumps(e) + "\n" for e in rec))
    events = read_sse(client)
    assert [e["data"]["text"] for e in events][0] == "recorded plan" and len(events) == 2


def test_live_without_model_is_503(client):
    r = client.post("/api/chat", json={"message": "hi"})
    assert r.status_code == 503 and "replay=1" in r.json()["detail"]


def test_live_runner_is_streamed_when_attached(client, monkeypatch):
    from agent import chat

    async def fake(message, profile, run_id):
        yield {"id": "evt_001", "ts": "t", "run_id": run_id, "type": "plan", "text": message}
        yield {"id": "evt_002", "ts": "t", "run_id": run_id, "type": "final", "text": "done"}
    monkeypatch.setattr(chat, "live_runner", fake)
    events = read_sse(client, url="/api/chat", body={"message": "hello"})
    assert [e["event"] for e in events] == ["plan", "final"] and events[0]["data"]["text"] == "hello"


def test_replay_and_live_work_without_a_body(client):
    with client.stream("POST", "/api/chat?replay=1&pace=0") as r:
        assert r.status_code == 200 and "event: final" in r.read().decode()
    assert client.post("/api/chat").status_code == 503


def _live(approvals, action_id, calls, fail=False):
    def send(approved):
        calls.append(approved)
        if fail:
            raise ConnectionError("provider down")
        return {"status": "sent" if approved else "declined"}
    return approvals.register(approvals.Pending(action_id=action_id, run_id="r", action="send_message",
                                                payload={}, on_resolve=send))


def test_live_action_runs_once_and_decline_never_sends(client):
    from agent import approvals
    calls = []
    _live(approvals, "live_1", calls)
    assert client.post("/api/approve", json={"action_id": "live_1", "approved": True}).json()["status"] == "sent"
    assert client.post("/api/approve", json={"action_id": "live_1", "approved": True}).status_code == 409
    assert calls == [True]
    with pytest.raises(approvals.DuplicateAction):              # re-registering can't reset a decision
        _live(approvals, "live_1", calls)
    _live(approvals, "live_2", calls)
    assert client.post("/api/approve", json={"action_id": "live_2", "approved": False}).json()["status"] == "declined"
    assert calls == [True, False]


def test_failed_send_can_be_retried(client):
    from agent import approvals
    calls = []
    p = _live(approvals, "live_3", calls, fail=True)
    r = client.post("/api/approve", json={"action_id": "live_3", "approved": True})
    assert r.status_code == 502 and approvals.get("live_3").approved is None
    p.on_resolve = lambda approved: {"status": "sent"}
    assert client.post("/api/approve", json={"action_id": "live_3", "approved": True}).json()["status"] == "sent"


def test_replay_action_with_a_callback_still_never_sends(client):
    from agent import approvals
    calls = []
    approvals.register(approvals.Pending(action_id="rp", run_id="r", action="send_message", payload={},
                                         replay=True, on_resolve=lambda a: calls.append(a) or {"status": "sent"}))
    r = client.post("/api/approve", json={"action_id": "rp", "approved": True}).json()
    assert r["replay"] is True and r["outbox_id"] is None and r["outbox_ids"] == []
    assert calls == []


def test_approve_returns_the_outbox_id_of_the_queued_message(client):
    from agent import approvals
    approvals.register(approvals.Pending(
        action_id="live_ob", run_id="r", action="send_message", payload={},
        on_resolve=lambda a: {"status": "queued 1 of 1", "outbox_id": "20261114T120000_abc123",
                              "outbox_ids": ["20261114T120000_abc123"]}))
    r = client.post("/api/approve", json={"action_id": "live_ob", "approved": True}).json()
    assert r["outbox_id"] == "20261114T120000_abc123" and r["outbox_ids"] == ["20261114T120000_abc123"]


def test_replay_speed_plays_faster_and_stays_marked(client):
    import time
    t0 = time.time()
    events = read_sse(client, url="/api/chat?replay=1&speed=100")
    assert time.time() - t0 < 3 and all(e["data"]["replay"] is True for e in events)
    with client.stream("POST", "/api/chat?replay=1&speed=0", json={}) as r:
        assert r.status_code == 422
    with client.stream("POST", "/api/chat?replay=1&speed=0.0001", json={}) as r:
        assert r.status_code == 422                                # cannot slow a replay below pace 10
