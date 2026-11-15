"""Preflight on a synthetic data dir: data checks, and one end-to-end run that starts its own API (no live run)."""
import json
import pathlib
import shutil

import pytest

from agent import preflight as P

ROOT = pathlib.Path(__file__).resolve().parents[1]
C = ROOT / "contracts"


@pytest.fixture()
def data(tmp_path, monkeypatch):
    (tmp_path / "cache").mkdir()
    (tmp_path / "batch").mkdir()
    (tmp_path / "replay").mkdir()
    for sid in ("synthetic_demo", "synthetic_1br"):
        shutil.copy(ROOT / f"tests/{sid}.json", tmp_path / f"cache/{sid}.json")
    ex = json.loads((C / "units_list.example.json").read_text())
    (tmp_path / "batch/index.json").write_text(json.dumps({
        "center": {"lat": ex["query"]["lat"], "lon": ex["query"]["lon"], "label": "test"}, "radius_km": 8.0,
        "chair_in": [27.0, 42.0], "processed": 2, "ranked": 2, "no_data": [], "failed": [],
        "updated_at": "2026-11-14T00:00:00+00:00", "units": ex["units"]}))
    shutil.copy(C / "chat_events.example.jsonl", tmp_path / "replay/run.jsonl")
    (tmp_path / "demo_units.json").write_text(json.dumps({"demo-main": "synthetic_demo", "demo-backup": "synthetic_1br",
                                                          "demo-pass": "synthetic_1br", "demo-sparse": "synthetic_demo"}))
    monkeypatch.setenv("ROLLIN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_data_checks_pass_then_fail_without_files(data, capsys):
    rep = P.Report()
    P.check_data(rep)
    assert rep.failed == 0 and len(rep.rows) == 7
    (data / "replay/run.jsonl").unlink()
    (data / "cache/synthetic_1br.json").unlink()
    rep = P.Report()
    P.check_data(rep)
    assert rep.failed == 3                                     # replay + two aliases pointing at the removed model
    out = capsys.readouterr().out
    assert "FAIL  data    demo-backup: model NOT cached" in out and "synthetic_1br" not in out   # aliases only


def test_end_to_end_without_live_run(data, capsys):
    code = P.main(["--no-live"])
    out = capsys.readouterr().out
    assert "PASS  replay" in out and "SKIP  live" in out and "PASS  api     demo-main plan" in out
    assert "demo missing" in out and "synthetic_demo" not in out and "synthetic_1br" not in out   # aliases only
    assert code == 0, out
