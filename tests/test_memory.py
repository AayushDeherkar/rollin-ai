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
    ('it is 25.5" by 41"', [25.5, 41.0]),
    ("2 bedrooms near TMC", None),
    ("unit 12 x 1400 sq ft", None),                       # not a plausible chair
])
def test_chair_from_message(msg, size):
    assert M.chair_from_message(msg) == size


def test_saved_then_used_then_updated(data):
    p1, m1 = M.resolve("27 inches wide and 42 inches long", {"sender_id": "s1"})
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
    p, m = M.resolve("27x42 please", {})
    assert m is None and p["chair_in"] == [27.0, 42.0] and not (data / "memory").exists()


def test_memory_event_text_and_basis(data):
    _, m = M.resolve("27x42", {"sender_id": "s2"})
    _, m = M.resolve("again", {"sender_id": "s2"})
    ev = A.Run("r").ev("memory", **A.memory_event("s2", m))
    assert ev["text"] == "Using the 27x42 in chair from your last request."
    assert ev["profile"]["chair_in"][0] == {"value": 27.0, "basis": "asked", "unit": "in", "source": "memory"}
    assert ev["path"] == f"/memories/profiles/{M.key_for('s2')}.json"
    _numbers_have_basis(ev, ev["id"])
    _, same = M.resolve("27x42", {"sender_id": "s2"})
    assert A.memory_event("s2", same)["text"] == "Your 27x42 in chair matches your saved profile."
