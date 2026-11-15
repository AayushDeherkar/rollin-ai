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


def test_send_message_records_unit_and_the_questions_as_sent(data):
    from agent import agent as A
    A._DRAFTED.clear()
    A.send_message("Leasing office (Synthetic)", "Hi\n1. What is the clear width of the closet door?\n2. Step-free?",
                   sid="synthetic_demo")
    rec = next(json.loads(p.read_text()) for p in (data / "outbox").glob("*.json") if p.stem != OID)
    assert rec["sid"] == "synthetic_demo" and rec["status"] == "pending"
    assert rec["questions"] == ["What is the clear width of the closet door?"]       # the fragment is not sent


def test_send_message_never_guesses_between_units_with_the_same_name(data):
    from agent import agent as A
    A._DRAFTED.clear()
    A._DRAFTED["Leasing office (1BR)"] = {"synthetic_demo"}
    assert A.message_unit("Leasing office (1BR)", None) == "synthetic_demo"
    A._DRAFTED["Leasing office (1BR)"].add("other_unit")
    assert A.message_unit("Leasing office (1BR)", None) is None            # two units share the name
    assert A.message_unit("Leasing office (1BR)", "synthetic_demo") == "synthetic_demo"
    assert A.message_unit("Somebody else", None) is None


@pytest.mark.parametrize("line,width", [
    ("It is 2'10\" wide", 34.0), ("80 inches tall and 28 inches wide", 28.0), ("a 32-inch door", 32.0),
    ("29.5\" clear", 29.5), ("3 ft 0 in", 36.0), ("Unit 12 in the building", None),
    ("28 in wide, 30 in frame", None), ("It's wide enough", None), ("Width 30 in, height 80 in", 30.0)])
def test_reply_widths(line, width):
    from agent.outbox import _inches
    assert _inches(line) == width


def test_nan_or_absurd_structured_width_is_not_stored(client):
    r = client.post("/api/answers", content='{"sid": "synthetic_demo", "answers": [{"room": "Closet", '
                    '"clear_width_in": NaN}]}', headers={"content-type": "application/json"})
    assert r.status_code == 200 and r.json()["rooms"][0]["clear_in"] is None
    client.post("/api/answers", json={"sid": "synthetic_demo", "answers": [{"room": "closet", "clear_width_in": 300}]})
    assert client.get("/api/units/synthetic_demo").status_code == 200
    assert closet(client)["answer"]["clear_in"]["value"] is None


def test_stored_nan_from_an_old_answer_file_does_not_break_the_unit(data, client):
    (data / "answers").mkdir(exist_ok=True)
    (data / "answers" / "20261114T000000_aaaaaa.json").write_text(
        '{"id": "20261114T000000_aaaaaa", "sid": "synthetic_demo", "rooms": [{"room_id": "closet", "label": "Closet", '
        '"clear_in": NaN, "said": ""}], "received_at": "2026-11-14T00:00:00Z"}')
    assert client.get("/api/units/synthetic_demo").status_code == 200
    assert closet(client)["answer"]["clear_in"] == {"value": None, "basis": "unknown"}


def test_reply_numbers_follow_the_numbers_as_sent(data, client):
    from agent import agent as A
    A.send_message("Leasing office (Synthetic)", "Hi\n2. Is the building entrance step-free today?\n"
                   "5. What is the clear width of the closet door?", sid="synthetic_demo")
    rec_path = next(p for p in (data / "outbox").glob("*.json") if p.stem != OID)
    rec = json.loads(rec_path.read_text())
    assert rec["questions"] == ["Is the building entrance step-free today?", "What is the clear width of the closet door?"]
    assert "\n1. Is the building" in rec["text"] and "\n2. What is" in rec["text"]       # renumbered as sent
    r = client.post("/api/answers", json={"outbox_id": rec_path.stem, "text": "1. yes\n2. 31 in"}).json()
    assert [x["room_id"] for x in r["rooms"]] == ["closet"] and r["rooms"][0]["clear_in"] == 31.0


def test_numbered_line_for_a_non_door_question_matches_no_room(client):
    r = client.post("/api/answers", json={"outbox_id": OID, "text": "2. The closet is by the entrance, 30 in."}).json()
    assert r["rooms"] == [] and r["unmatched"] == ["2. The closet is by the entrance, 30 in."]


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
        gen2 = h.stream(first["id"])                               # an event published mid-replay is sent once
        await gen2.__anext__()
        h.publish("delivered", outbox_id="d")
        seen = [await gen2.__anext__() for _ in range(3)]
        nxt = asyncio.ensure_future(gen2.__anext__())
        await asyncio.sleep(0.05)
        assert sum('"outbox_id":"d"' in x for x in seen) == 1 and not nxt.done()
        nxt.cancel()
        with pytest.raises(asyncio.CancelledError):
            await nxt
        assert not h.subs

    asyncio.run(go())


def test_clean_archives_only_pending_messages_without_a_unit(data, capsys):
    from agent import outbox
    box = data / "outbox"
    old = {"to": "Leasing office", "text": "old test", "queued_at": "2026-11-14T10:00:00+00:00"}
    (box / "20261114T100000_aaaaaa.json").write_text(json.dumps(old))                        # no sid, pending
    (box / "20261114T100001_bbbbbb.json").write_text(json.dumps({**old, "status": "delivered"}))
    (box / "20261114T100002_cccccc.json").write_text(json.dumps(                            # approved now, unit unknown
        {**old, "status": "pending", "sid": None, "questions": []}))
    assert outbox.main(["clean", "--dry-run"]) == 0 and "would archive 1" in capsys.readouterr().out
    assert (box / "20261114T100000_aaaaaa.json").exists()
    assert outbox.main(["clean"]) == 0
    assert not (box / "20261114T100000_aaaaaa.json").exists()
    kept = json.loads((box / "archive/20261114T100000_aaaaaa.json").read_text())
    assert kept["status"] == "archived" and kept["text"] == "old test"                      # kept, not deleted
    assert (box / "20261114T100001_bbbbbb.json").exists() and (box / f"{OID}.json").exists()  # delivered / has a unit
    assert [i["id"] for i in outbox.pending()] == ["20261114T100002_cccccc", OID]   # a real message is never archived
    assert outbox.archive_unlinked() == []                                                  # idempotent


def test_a_reply_to_a_non_width_question_never_answers_a_room():
    from agent.outbox import match_answers
    rooms = [{"room_id": "o1", "label": "Other", "status": "blocked"}, {"room_id": "o2", "label": "Other", "status": "unknown"}]
    qs = ['Would it be possible to widen the doorway to the room marked "Other" on the floor plan? From the plan...',
          "Is the building entrance step-free, and is there an elevator?",
          'What is the clear width of the door to the room marked "Other", in inches?']
    hit, _ = match_answers(rooms, "1. No, the building does not allow that.", [], qs)
    assert hit == []
    hit, _ = match_answers(rooms, "3. 30 inches", [], qs)
    assert [(h["room_id"], h["clear_in"]) for h in hit] == [("o2", 30.0)]
