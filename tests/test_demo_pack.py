"""Demo pack and health status on a synthetic data dir."""
import json
import pathlib
import shutil
import zipfile

import pytest

from engine import demo_pack as D

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def data(tmp_path, monkeypatch):
    d = tmp_path / "data"
    (d / "cache").mkdir(parents=True)
    (d / "batch").mkdir()
    (d / "replay").mkdir()
    sid = D.DEMO_UNITS[0]
    shutil.copy(ROOT / "tests/synthetic_demo.json", d / f"cache/{sid}.json")
    (d / "batch/index.json").write_text(json.dumps({"units": [{"sid": sid}]}))
    (d / "replay/run.jsonl").write_text(json.dumps({"type": "final", "shortlist": [{"sid": sid}]}) + "\n")
    (d / "cache/aerial_x.jpg").write_bytes(b"jpg")
    (d / "cache/aerial_x.findings.json").write_text("{}")
    (d / f"cache/aerial_{sid}.json").write_text(json.dumps({"image": "aerial_x.jpg", "findings_file": "aerial_x.findings.json"}))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(d))
    return d


def test_status_lists_present_and_missing(data):
    s = D.demo_status()
    main = s["units"][D.DEMO_UNITS[0]]
    assert s["index"] and s["replay"] and main == {"model": True, "aerial": True, "vision": False}
    assert f"{D.DEMO_UNITS[0]}:vision" in s["missing"] and f"{D.DEMO_UNITS[1]}:model" in s["missing"]


def test_pack_contains_everything_present(data, tmp_path):
    res = D.build(tmp_path / "out" / "pack.zip")
    names = set(zipfile.ZipFile(res["zip"]).namelist())
    sid = D.DEMO_UNITS[0]
    assert {"data/batch/index.json", "data/replay/run.jsonl", f"data/cache/{sid}.json",
            f"data/cache/aerial_{sid}.json", "data/cache/aerial_x.jpg", "MANIFEST.json", "README.txt"} <= names
    manifest = json.loads(zipfile.ZipFile(res["zip"]).read("MANIFEST.json"))
    assert manifest["units"][sid]["model"] == 1 and manifest["missing_for_demo"]


def test_pack_refuses_to_write_inside_the_repo(data):
    with pytest.raises(SystemExit):
        D.build(ROOT / "out" / "pack.zip")


def test_health_reports_demo_status(data):
    from fastapi.testclient import TestClient
    from agent.server import app
    h = TestClient(app).get("/api/health").json()
    assert h["demo"]["main_unit"] == D.DEMO_UNITS[0] and "missing" in h["demo"]
