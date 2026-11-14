"""Batch pipeline and client behaviour on synthetic data (no network, no real data)."""
import json
import pathlib

import pytest

from engine import batch, matterport
from engine.fit import analyze_model

ROOT = pathlib.Path(__file__).resolve().parents[1]
SYNTH = json.loads((ROOT / "tests/synthetic_demo.json").read_text())["data"]["model"]


def keys_match(a, b, where="root"):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{where}: {sorted(set(a) ^ set(b))}"
        for k in a:
            keys_match(a[k], b[k], f"{where}.{k}")
    elif isinstance(a, list) and isinstance(b, list) and a and b and isinstance(a[0], dict):
        keys_match(a[0], b[0], f"{where}[0]")


@pytest.mark.parametrize("hinges,example", [(False, "unit_result.example.json"),
                                            (True, "unit_result.hinges.example.json")])
def test_analyze_model_matches_contract(hinges, example):
    out = analyze_model(SYNTH, "synthetic_demo", 27.0, 42.0, hinges)
    keys_match(out, json.loads((ROOT / "contracts" / example).read_text()))


def test_candidates_filters_units_by_radius(tmp_path, monkeypatch):
    csv = tmp_path / "idx.csv"
    csv.write_text("sid,name,lat,lon\n"
                   "near1,\"<unit name>\",29.71,-95.40\n"
                   "near2,<unit name>,29.72,-95.40\n"
                   "amenity,Clubroom,29.71,-95.40\n"
                   "far,2BR 2BA,30.30,-97.70\n"
                   "nocoord,1BR 1BA,,\n")
    monkeypatch.setattr(batch, "INDEX_CSV", csv)
    got = batch.candidates((29.7095, -95.3982), 8.0)
    assert [c["sid"] for c in got] == ["near1", "near2"]
    assert got[0]["distance_km"] <= got[1]["distance_km"]


def test_run_one_row_and_no_data(tmp_path, monkeypatch):
    monkeypatch.setattr(batch, "RESULTS", tmp_path)
    empty = {"name": "empty", "floors": [{"id": "f", "label": "F", "vertices": [], "edges": []}], "rooms": []}
    models = {"synthetic_demo": SYNTH, "empty": empty}
    monkeypatch.setattr(batch, "get_model", lambda sid: models[sid])
    c = {"sid": "synthetic_demo", "lat": 29.71, "lon": -95.40, "distance_km": 0.1, "name": "x"}
    row = batch.run_one(c, 27.0, 42.0)["row"]
    units = json.loads((ROOT / "contracts/units_list.example.json").read_text())["units"]
    assert set(units[0]) - {"synthetic"} <= set(row)
    assert row["usable"] and row["counts"]["blocked"] == 2
    assert row["with_hinges"]["counts"]["reachable"] == row["counts"]["reachable"] + 1   # bedroom flips
    assert (tmp_path / "synthetic_demo.json").exists()
    none = batch.run_one({**c, "sid": "empty"}, 27.0, 42.0)["row"]
    assert none["usable"] is False


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_query_retries_non_json_and_internal(monkeypatch):
    monkeypatch.setenv("MATTERPORT_API_KEY", "k")
    monkeypatch.setenv("MATTERPORT_API_TOKEN", "t")
    monkeypatch.setattr(matterport.time, "sleep", lambda s: None)
    replies = iter([_Resp(200, ValueError("html")),
                    _Resp(200, {"errors": [{"message": "x", "extensions": {"code": "internal"}}]}),
                    _Resp(200, {"data": {"model": {"name": "ok"}}})])
    monkeypatch.setattr(matterport._session, "post", lambda *a, **k: next(replies))
    assert matterport.query("q", {})["model"]["name"] == "ok"


def test_query_not_found_fails_fast(monkeypatch):
    monkeypatch.setenv("MATTERPORT_API_KEY", "k")
    monkeypatch.setenv("MATTERPORT_API_TOKEN", "t")
    calls = []

    def post(*a, **k):
        calls.append(1)
        return _Resp(200, {"errors": [{"message": "Not Found", "extensions": {"code": "not.found"}}]})
    monkeypatch.setattr(matterport._session, "post", post)
    with pytest.raises(matterport.MatterportError):
        matterport.query("q", {})
    assert len(calls) == 1


def test_chair_that_fits_nowhere_blocks_every_room():
    out = analyze_model(SYNTH, "synthetic_demo", 170.0, 170.0)          # 4.3 m square: wider than any room
    rooms = out["floors"][0]["rooms"]
    assert rooms and {r["status"] for r in rooms} <= {"blocked", "unknown"}
    assert any("start room" in (r["reason"] or "") for r in rooms)
    keys_match(out, json.loads((ROOT / "contracts/unit_result.example.json").read_text()))


def test_resume_recomputes_for_a_different_chair(tmp_path, monkeypatch):
    monkeypatch.setattr(batch, "RESULTS", tmp_path)
    monkeypatch.setattr(batch, "get_model", lambda sid: SYNTH)
    c = {"sid": "synthetic_demo", "lat": 29.71, "lon": -95.40, "distance_km": 0.1, "name": "x"}
    first = batch.run_one(c, 27.0, 42.0)["row"]
    again = batch.run_one({**c, "distance_km": 2.5}, 27.0, 42.0)["row"]
    assert again["counts"] == first["counts"] and again["distance_km"] == 2.5
    narrow = batch.run_one(c, 20.0, 36.0)["row"]
    assert narrow["chair_in"] == [20.0, 36.0] and narrow["counts"]["reachable"] > first["counts"]["reachable"]
