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
    sid = "synthunit01"
    (d / "demo_units.json").write_text(json.dumps({"demo-main": sid, "demo-backup": "synthunit02"}))
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
    main = s["units"]["synthunit01"]
    assert s["index"] and s["replay"] and main == {"model": True, "aerial": True, "vision": False}
    assert "synthunit01:vision" in s["missing"] and "synthunit02:model" in s["missing"]


def test_pack_contains_everything_present(data, tmp_path):
    res = D.build(tmp_path / "out" / "pack.zip")
    names = set(zipfile.ZipFile(res["zip"]).namelist())
    sid = "synthunit01"
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
    assert h["demo"]["main_unit"] == "demo-main" and "synthunit01" in h["demo"]["units"]


def test_bad_link_files_never_break_health_or_build(data, tmp_path):
    sid = "synthunit01"
    (data / "cache" / "vision").mkdir()
    for aerial, vision in (("", "[]"), ('{"image": null}', '{"images": null}'), ('{"image": "../../.env"}', '{"images": [5]}')):
        (data / f"cache/aerial_{sid}.json").write_text(aerial)
        (data / f"cache/vision/{sid}.json").write_text(vision)
        D.demo_status()
        names = set(zipfile.ZipFile(D.build(tmp_path / "p.zip")["zip"]).namelist())
        assert not any(".env" in n for n in names)


def test_unsafe_sids_are_skipped(data):
    (data / "batch/index.json").write_text(json.dumps({"units": [{"sid": "../../x"}, {"sid": "ok_sid_1"}]}))
    assert "../../x" not in D.unit_list(data) and "ok_sid_1" in D.unit_list(data)


def test_status_without_alias_file_says_so(data):
    (data / "demo_units.json").unlink()
    assert D.demo_status()["missing"][0].startswith("data/demo_units.json")


@pytest.mark.parametrize("extra", [None, 5, "abc"])
def test_malformed_extra_never_breaks_health(data, extra):
    (data / "demo_units.json").write_text(json.dumps({"demo-main": "synthunit01", "extra": extra}))
    assert D.demo_status()["units"] == {"synthunit01": {"model": True, "aerial": True, "vision": False}}
