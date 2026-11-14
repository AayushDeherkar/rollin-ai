"""agent/server.py against the contracts, using a temp data dir built from synthetic examples only."""
import json
import pathlib
import shutil

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
C = ROOT / "contracts"


def keys_match(a, b, where="root"):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{where}: {sorted(set(a) ^ set(b))}"
        for k in a:
            keys_match(a[k], b[k], f"{where}.{k}")
    elif isinstance(a, list) and isinstance(b, list) and a and b and isinstance(a[0], dict):
        keys_match(a[0], b[0], f"{where}[0]")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    (tmp_path / "cache").mkdir()
    (tmp_path / "batch").mkdir()
    shutil.copy(ROOT / "tests/synthetic_demo.json", tmp_path / "cache/synthetic_demo.json")
    ex = json.loads((C / "units_list.example.json").read_text())
    index = {"center": {"lat": ex["query"]["lat"], "lon": ex["query"]["lon"], "label": "test"},
             "radius_km": 8.0, "chair_in": [27.0, 42.0], "candidates": 2, "processed": 2, "ranked": 2,
             "no_data": [], "failed": [], "updated_at": "2026-11-14T00:00:00+00:00", "units": ex["units"]}
    (tmp_path / "batch/index.json").write_text(json.dumps(index))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    from agent.server import app, _fit
    _fit.cache_clear()
    return TestClient(app)


def test_units_matches_contract(client):
    r = client.get("/api/units")
    assert r.status_code == 200
    keys_match(r.json(), json.loads((C / "units_list.example.json").read_text()))


def test_units_hinges_reranks(client):
    plain = client.get("/api/units").json()["units"]
    hinged = client.get("/api/units?hinges=true").json()["units"]
    demo = next(u for u in hinged if u["sid"] == "synthetic_demo")
    assert demo["scenario"] == "offset hinges on every door"
    assert demo["counts"] == demo["with_hinges"]["counts"]
    assert demo["score"] > next(u for u in plain if u["sid"] == "synthetic_demo")["score"]


def test_units_filters(client):
    assert client.get("/api/units?radius_km=0.01").json()["total"] == 0
    assert client.get("/api/units?beds=1").json()["total"] == 2
    assert client.get("/api/units?beds=2").json()["total"] == 0
    assert client.get("/api/units?w=25").status_code == 422          # list was computed for 27 in


def test_unit_detail_matches_contract_and_hinges_flip(client):
    a = client.get("/api/units/synthetic_demo")
    b = client.get("/api/units/synthetic_demo?hinges=true")
    assert a.status_code == b.status_code == 200
    keys_match(a.json(), json.loads((C / "unit_result.example.json").read_text()))
    st = lambda r: {x["label"]: x["status"] for x in r.json()["floors"][0]["rooms"]}
    assert st(a)["Bedroom"] == "blocked" and st(b)["Bedroom"] == "reachable"


def test_unit_errors(client):
    assert client.get("/api/units/..%2F..%2Fsecret").status_code in (400, 404)
    assert client.get("/api/units/bad-id!").status_code == 400
    assert client.get("/api/units/notCached123").status_code == 404


def test_cors_allows_web_dev_origin(client):
    r = client.get("/api/units", headers={"Origin": "http://localhost:3000"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
    r = client.get("/api/units", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_no_index_is_503(client, tmp_path):
    (tmp_path / "batch/index.json").unlink()
    assert client.get("/api/units").status_code == 503
