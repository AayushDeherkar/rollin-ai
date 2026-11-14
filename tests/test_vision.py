"""Vision findings from a cached vision pass (no network, no model)."""
import json
import pathlib
import shutil
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from agent import agent as A
from engine import vision as V
from tests.test_contracts import _numbers_have_basis

ROOT = pathlib.Path(__file__).resolve().parents[1]
ITEMS = [{"kind": "bathroom", "room_id": "bath", "room": "Bathroom", "status": "blocked", "pano_id": "pano1",
          "pano_distance_m": 0.4, "image": "synthetic_demo_pano1.jpg", "label": V.LABEL,
          "answers": {"bathing": {"question": "q", "answer": "bathtub", "note": "n"},
                      "grab_bars": {"question": "q", "answer": "no", "note": "n"},
                      "threshold": {"question": "q", "answer": "unclear", "note": "n"}}},
         {"kind": "door", "room_id": "bed", "room": "Bedroom", "status": "blocked", "pano_id": None,
          "answers": {"threshold": {"question": "q", "answer": "unclear", "note": "no panorama near this spot"}}}]


@pytest.fixture()
def data(tmp_path, monkeypatch):
    (tmp_path / "cache/vision").mkdir(parents=True)
    shutil.copy(ROOT / "tests/synthetic_demo.json", tmp_path / "cache/synthetic_demo.json")
    (tmp_path / "cache/vision/synthetic_demo.json").write_text(json.dumps({"sid": "synthetic_demo", "items": ITEMS,
                                                                         "images": ["synthetic_demo_pano1.jpg"]}))
    (tmp_path / "cache/vision/synthetic_demo_pano1.jpg").write_bytes(b"\xff\xd8\xff fake")
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_targets_are_bathrooms_and_blocked_doors(data, monkeypatch):
    monkeypatch.setattr(V, "get_model", lambda sid: json.loads((ROOT / "tests/synthetic_demo.json").read_text())["data"]["model"])
    kinds = {(t["kind"], t["room"]) for t in V.targets("synthetic_demo")}
    assert ("bathroom", "Bathroom") in kinds and ("door", "Bedroom") in kinds


def test_nearest_pano_prefers_inside_the_bathroom_and_rejects_far_ones():
    t = {"kind": "bathroom", "xy": [1, 1], "polygon": [[0, 0], [2, 0], [2, 2], [0, 2]]}
    near_out = {"id": "out", "position": {"x": 2.3, "y": 1}}
    inside = {"id": "in", "position": {"x": 1.8, "y": 1.9}}
    assert V.nearest_pano([near_out, inside], t)[0]["id"] == "in"
    assert V.nearest_pano([{"id": "far", "position": {"x": 40, "y": 40}}], t) is None


def test_vision_findings_cite_panos_and_skip_unseen_spots(data):
    f = A.vision_findings("synthetic_demo")
    assert len(f) == 1 and f[0]["evidence"]["pano_id"] == "pano1" and f[0]["label"].endswith("estimated")
    assert f[0]["text"].startswith("Bathroom: bathing: bathtub; grab bars: no; threshold: unclear")
    ev = A.Run("r").ev("finding", **f[0])
    _numbers_have_basis(ev, ev["id"])


def test_findings_stream_once_after_engine_results(data):
    r = A.Run("r")
    evs = r.fit_events(A.run_fit("synthetic_demo"), {"sid": "synthetic_demo"})
    evs += r.fit_events(A.run_fit("synthetic_demo", hinges=True), {"sid": "synthetic_demo"})
    assert sum(e.get("scenario") == "panorama check" for e in evs) == 1
    assert any(c["claim"].startswith("Bathroom fixtures") for c in r.checked())


def test_vision_api(data):
    from agent.server import app
    c = TestClient(app)
    assert c.get("/api/vision/synthetic_demo").json()["items"][0]["pano_id"] == "pano1"
    img = c.get("/api/vision/synthetic_demo/pano1")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert c.get("/api/vision/synthetic_demo/nope").status_code == 404
    assert c.get("/api/vision/bad-id!").status_code == 400
