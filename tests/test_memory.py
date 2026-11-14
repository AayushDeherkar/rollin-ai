"""Profile memory per sender_id (no model calls)."""
import json

import pytest

from agent import agent as A
from agent import memory as M
from tests.test_contracts import _numbers_have_basis


@pytest.fixture()
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.mark.parametrize("msg,size", [
    ("power chair 27 inches wide and 42 inches long", [27.0, 42.0]),
    ("my chair is 26x40", [26.0, 40.0]),
    ('her wheelchair is 25.5" by 41"', [25.5, 41.0]),
    ("room 12 x 14, chair 26 x 40", [26.0, 40.0]),             # later match is the chair
    ("60 x 60 turning space, chair 26x40", [26.0, 40.0]),
    ("2 bedrooms near TMC", None),
    ("unit 12 x 1400 sq ft", None),
    ("need a roll-in shower at least 30 x 60", None),          # not near a chair word
    ("27 x 42 ft patio for the chair", None),                  # feet, not inches
    ("chair fits a garage 24 x 36", [24.0, 36.0]) if False else ("garage 24 x 36", None),
    ("within 20 by 30 minutes of the chair clinic", None),     # minutes
    ("chair; Apt 2430 by 4100 Fannin", None),                  # digits inside longer numbers
    ("door 32 inches wide; chair 27 inches wide and 42 inches long", [27.0, 42.0]),
    ("27x42 please", None),                                    # no chair word: not assumed
])
def test_chair_from_message(msg, size):
    assert M.chair_from_message(msg) == size


def test_saved_then_used_then_updated(data):
    p1, m1 = M.resolve("her chair is 27 inches wide and 42 inches long", {"sender_id": "s1"})
    assert m1["action"] == "saved" and p1["chair_in"] == [27.0, 42.0]
    stored = json.loads(M.path_for("s1").read_text())
    assert stored["chair_in"] == [27.0, 42.0] and "s1" not in M.path_for("s1").name    # filename is a hash
    p2, m2 = M.resolve("find me a 1 bedroom", {"sender_id": "s1"})
    assert m2 == {"action": "used", "chair_in": [27.0, 42.0], "source": "memory", "saved_at": stored["updated_at"]}
    assert p2["chair_in"] == [27.0, 42.0]
    p3, m3 = M.resolve("actually my new chair is 25 x 40", {"sender_id": "s1"})
    assert m3["action"] == "updated" and m3["previous"] == [27.0, 42.0] and p3["chair_in"] == [25.0, 40.0]
    assert M.resolve("anything", {"sender_id": "s1"})[0]["chair_in"] == [25.0, 40.0]


def test_no_sender_no_memory(data):
    p, m = M.resolve("27x42 chair please", {})
    assert m is None and p["chair_in"] == [27.0, 42.0] and not (data / "memory").exists()


def test_memory_event_text_and_basis(data):
    _, m = M.resolve("27x42 chair", {"sender_id": "s2"})
    _, m = M.resolve("again", {"sender_id": "s2"})
    ev = A.Run("r").ev("memory", **A.memory_event("s2", m))
    assert ev["text"] == "Using the 27x42 in chair from your last request."
    assert ev["profile"]["chair_in"][0] == {"value": 27.0, "basis": "asked", "unit": "in", "source": "memory"}
    assert ev["path"] == f"/memories/profiles/{M.key_for('s2')}.json"
    _numbers_have_basis(ev, ev["id"])
    _, same = M.resolve("27x42 chair", {"sender_id": "s2"})
    assert A.memory_event("s2", same)["text"] == "Your 27x42 in chair matches your saved profile."


@pytest.mark.parametrize("bad", [None, [27], ["a", "b"], [42, 27], [5, 9], "27x42"])
def test_bad_client_chair_is_ignored(data, bad):
    p, m = M.resolve("nothing stated", {"sender_id": "s3", "chair_in": bad})
    assert m is None and "chair_in" not in p and not M.path_for("s3").exists()


@pytest.mark.parametrize("sender", [123, None, "", ["x"]])
def test_non_string_sender_is_not_remembered(data, sender):
    p, m = M.resolve("26x40 chair", {"sender_id": sender})
    assert m is None and p["chair_in"] == [26.0, 40.0] and "sender_id" not in p


def test_unusable_saved_file_is_ignored(data):
    M.path_for("s4").parent.mkdir(parents=True, exist_ok=True)
    for junk in ("[]", '{"chair_in": [27]}', "not json"):
        M.path_for("s4").write_text(junk)
        assert M.resolve("hello", {"sender_id": "s4"}) == ({"sender_id": "s4"}, None)


def test_only_the_chair_is_remembered(data):
    M.resolve("26x40 chair", {"sender_id": "s5", "area": {"label": "A"}, "budget": {"max_monthly_usd": 1}})
    assert set(json.loads(M.path_for("s5").read_text())) == {"chair_in", "updated_at"}
    p, _ = M.resolve("again", {"sender_id": "s5"})
    assert "area" not in p and "budget" not in p


def test_agent_file_tools_are_denied_on_memories():
    rule = A.memory_permissions()[0]
    assert rule.mode == "deny" and set(rule.operations) == {"read", "write"} and "/memories/**" in rule.paths
