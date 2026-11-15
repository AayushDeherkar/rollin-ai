"""Chair-size sweep on the synthetic apartment: per-unit results, aggregates with no ids, GET /api/insights."""
import json
import pathlib
import shutil

import pytest

from engine import sweep as S

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def data(tmp_path, monkeypatch):
    (tmp_path / "cache").mkdir()
    shutil.copy(ROOT / "tests/synthetic_demo.json", tmp_path / "cache/synthetic_demo.json")
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_length_scales_with_width():
    assert S.length_for(27) == 42.0 and S.length_for(22) == 34.0 and S.length_for(32) == 50.0


def test_room_type():
    assert S.room_type("Bedroom 2") == "bedroom" and S.room_type("Primary  Bathroom") == "primary bathroom"


def test_sweep_unit_is_monotone_and_cached(data):
    rec = S.sweep_unit("synthetic_demo", str(data / "cache/synthetic_demo.json"))
    blocked = [rec["by_width"][str(w)]["scanned"]["blocked"] for w in S.WIDTHS]
    assert blocked == sorted(blocked)                         # a wider chair never gets into more rooms
    for w in S.WIDTHS:
        r = rec["by_width"][str(w)]
        assert r["hinges"]["blocked"] <= r["scanned"]["blocked"]
    ref = rec["reference"]
    assert ["bedroom", "blocked"] in ref["rooms"] and ref["blocking_door_clear_in"]
    assert (data / "batch/sweep/synthetic_demo.json").exists()
    assert S.sweep_unit("synthetic_demo", "missing-path-not-read") == rec      # second call reads the cache


def test_aggregate_has_counts_only(data):
    rec = S.sweep_unit("synthetic_demo", str(data / "cache/synthetic_demo.json"))
    agg = S.aggregate([rec, rec], 8.0, "test area")
    text = json.dumps(agg)
    assert "synthetic_demo" not in text and agg["scope"]["units"] == 2
    assert [r["width_in"] for r in agg["sweep"]] == list(S.WIDTHS)
    assert agg["length_rule"]["basis"] == "assumed"
    ref = agg["at_reference_chair"]
    assert sum(b["doors"] for b in ref["blocking_door_clear_in_histogram"]) == ref["blocking_doors"]
    assert ref["blocking_room_types"][0]["blocked"] >= ref["blocking_room_types"][-1]["blocked"]


def test_tracked_insights_file_has_no_unit_ids():
    p = ROOT / "data" / "insights.json"
    if not p.exists():
        pytest.skip("no sweep committed yet")
    doc = json.loads(p.read_text())
    assert set(doc) >= {"sweep", "at_reference_chair", "length_rule", "scope"}
    text = json.dumps(doc)
    for key in ('"sid"', '"name"', '"lat"', '"lon"', "matterport"):
        assert key not in text.lower()


def test_insights_endpoint():
    from fastapi.testclient import TestClient
    from agent.server import app
    r = TestClient(app).get("/api/insights")
    assert r.status_code == 200 and set(r.json()) == {"sweep", "chair_presets", "note"}
