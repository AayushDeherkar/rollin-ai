"""Outbox delivery, leasing-office answers and the events stream, on a synthetic data dir."""
import asyncio
import json
import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
OID = "20261114T120000_abc123"


@pytest.fixture()
def data(tmp_path, monkeypatch):
    (tmp_path / "cache").mkdir()
    shutil.copy(ROOT / "tests/synthetic_demo.json", tmp_path / "cache/synthetic_demo.json")
    (tmp_path / "outbox").mkdir()
    (tmp_path / "outbox" / f"{OID}.json").write_text(json.dumps({
        "to": "Leasing office (Synthetic)", "text": "I am an AI assistant ... 1. What is the clear width of the closet door?",
        "queued_at": "2026-11-14T12:00:00+00:00", "status": "pending", "sid": "synthetic_demo",
        "questions": ["What is the clear width of the closet door?", "Is the entrance step-free?"],
        "chair_in": [27.0, 42.0]}))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    from agent.server import _fit
    _fit.cache_clear()
    return tmp_path


@pytest.fixture()
def client(data):
    from agent.server import app
    return TestClient(app)


def closet(client):
    unit = client.get("/api/units/synthetic_demo").json()
    return next(r for f in unit["floors"] for r in f["rooms"] if r["room_id"] == "closet")


def test_outbox_lists_pending_then_delivered_once(client):
    from agent.outbox import hub
    out = client.get("/api/outbox").json()
    assert out["total"] == 1 and out["items"][0]["id"] == OID and out["items"][0]["sid"] == "synthetic_demo"
    r = client.post(f"/api/outbox/{OID}/delivered", json={"via": "imessage"})
    assert r.status_code == 200 and r.json()["status"] == "delivered" and r.json()["via"] == "imessage"
    ev = hub.recent[-1]
    assert ev["type"] == "delivered" and ev["outbox_id"] == OID and {"id", "ts", "run_id"} <= set(ev)
    assert client.get("/api/outbox").json()["total"] == 0
    assert client.post(f"/api/outbox/{OID}/delivered").status_code == 409
    assert client.post("/api/outbox/20261114T120000_ffffff/delivered").status_code == 404
    assert client.post("/api/outbox/..%2Fsecrets/delivered").status_code in (400, 404)


def test_numbered_reply_marks_unknown_room_asked(client):
    from agent.outbox import hub
    assert "basis" not in closet(client)
    r = client.post("/api/answers", json={"outbox_id": OID, "from": "leasing office",
                                          "text": "Hi!\n1. It is 30 inches wide.\n2. Yes, no steps."}).json()
    assert [x["room_id"] for x in r["rooms"]] == ["closet"] and r["rooms"][0]["clear_in"] == 30.0
    assert r["unmatched"] == ["Hi!", "2. Yes, no steps."]
    c = closet(client)
    assert c["status"] == "unknown" and c["basis"] == "asked"          # the engine verdict is not changed
    assert c["answer"]["clear_in"] == {"value": 30.0, "unit": "in", "basis": "asked", "source": "landlord"}
    ev = hub.recent[-1]
    assert ev["type"] == "answer" and ev["rooms"][0]["basis"] == "asked" and ev["sid"] == "synthetic_demo"


def test_reply_naming_the_room_without_a_width_stays_unknown_number(client):
    r = client.post("/api/answers", json={"sid": "synthetic_demo", "text": "The closet door is wide enough."}).json()
    assert r["rooms"][0]["clear_in"] is None
    assert closet(client)["answer"]["clear_in"] == {"value": None, "basis": "unknown"}


def test_structured_answers_and_rooms_that_are_not_unknown(client):
    r = client.post("/api/answers", json={"sid": "synthetic_demo", "answers": [
        {"room": "Closet", "clear_width_in": 31}, {"room": "Bedroom", "clear_width_in": 40}]}).json()
    assert [x["label"] for x in r["rooms"]] == ["Closet"] and r["unmatched"] == ["Bedroom"]   # bedroom is measured
    unit = client.get("/api/units/synthetic_demo").json()
    bed = next(r for f in unit["floors"] for r in f["rooms"] if r["room_id"] == "bed")
    assert "basis" not in bed and bed["status"] == "blocked"


def test_answer_validation(client):
    assert client.post("/api/answers", json={"text": "hi"}).status_code == 422
    assert client.post("/api/answers", json={"sid": "synthetic_demo"}).status_code == 422
    assert client.post("/api/answers", json={"sid": "nope_not_cached", "text": "x"}).status_code == 404
    assert client.post("/api/answers", json={"outbox_id": "bad", "text": "x"}).status_code == 400


def test_answered_rooms_are_not_asked_again(data, client, monkeypatch):
    from agent import agent as A
    assert any("closet" in q for q in A.unit_questions("synthetic_demo", 27, 42))
    client.post("/api/answers", json={"sid": "synthetic_demo", "text": "Closet door: 30 in"})
    assert not any("closet" in q for q in A.unit_questions("synthetic_demo", 27, 42))


def test_send_message_records_the_drafted_unit(data):
    from agent import agent as A
    A._DRAFTS["Leasing office (Synthetic)"] = {"sid": "synthetic_demo", "questions": ["q1"], "chair_in": [27.0, 42.0]}
    A.send_message("Leasing office (Synthetic)", "Hello")
    recs = [json.loads(p.read_text()) for p in (data / "outbox").glob("*.json") if p.stem != OID]
    assert recs[0]["sid"] == "synthetic_demo" and recs[0]["questions"] == ["q1"] and recs[0]["status"] == "pending"


def test_events_stream_replays_after_last_id_and_pushes_new():
    from agent.outbox import Hub

    async def go():
        h = Hub()
        first = h.publish("delivered", outbox_id="a")
        h.publish("delivered", outbox_id="b")
        gen = h.stream(first["id"])
        assert (await gen.__anext__()).startswith(":")
        assert '"outbox_id":"b"' in await gen.__anext__()         # missed while disconnected
        nxt = asyncio.ensure_future(gen.__anext__())
        await asyncio.sleep(0)
        h.publish("answer", outbox_id="c")
        assert "event: answer" in await asyncio.wait_for(nxt, 2)
        await gen.aclose()
        assert not h.subs

    asyncio.run(go())
