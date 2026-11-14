"""Engine output and the shared contract examples must stay in sync."""
import json
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
C = ROOT / "contracts"
BASIS = {"measured", "estimated", "assumed", "asked", "unknown"}
EVENT_TYPES = {"plan", "tool", "finding", "verify", "approval_needed", "final"}


def run_fit(name, hinges=False):
    args = [sys.executable, str(ROOT / "engine/fit.py"), "--file", str(ROOT / f"tests/{name}.json")]
    subprocess.run(args + (["--hinges"] if hinges else []), cwd=ROOT, check=True, capture_output=True)
    return json.loads((ROOT / f"out/{name}_fit{'_hinges' if hinges else ''}.json").read_text())


def load(name):
    return json.loads((C / name).read_text())


def keys_match(a, b, where="root"):
    """Same keys at every dict level; lists compared through their first element."""
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{where}: {sorted(set(a) ^ set(b))}"
        for k in a:
            keys_match(a[k], b[k], f"{where}.{k}")
    elif isinstance(a, list) and isinstance(b, list) and a and b and isinstance(a[0], dict):
        keys_match(a[0], b[0], f"{where}[0]")


@pytest.mark.parametrize("hinges,example", [(False, "unit_result.example.json"),
                                            (True, "unit_result.hinges.example.json")])
def test_engine_output_has_contract_keys(hinges, example):
    keys_match(run_fit("synthetic_demo", hinges), load(example))


def test_hinges_example_flips_a_room():
    before = {r["room_id"]: r["status"] for f in load("unit_result.example.json")["floors"] for r in f["rooms"]}
    after = {r["room_id"]: r["status"] for f in load("unit_result.hinges.example.json")["floors"] for r in f["rooms"]}
    assert any(before[k] == "blocked" and after[k] == "reachable" for k in before)


def test_examples_are_synthetic():
    for f in C.glob("*.example.json*"):
        text = f.read_text()
        assert "synthetic" in text, f"{f.name} should come from a synthetic apartment"


def test_units_list_shape_and_ranking():
    d = load("units_list.example.json")
    assert set(d) == {"query", "total", "units", "source"} and d["total"] == len(d["units"])
    for u in d["units"]:
        assert {"sid", "name", "lat", "lon", "score", "counts", "summary", "basis", "source",
                "distance_km", "with_hinges", "usable"} <= set(u)
        assert set(u["with_hinges"]["counts"]) == {"reachable", "blocked", "unknown"}
        assert set(u["counts"]) == {"reachable", "blocked", "unknown"}
        assert set(u["basis"].values()) <= BASIS
    scores = [u["score"] for u in d["units"]]
    assert scores == sorted(scores, reverse=True)


def _numbers_have_basis(x, path, parent_has_basis=False):
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return
    if isinstance(x, (int, float)):
        assert parent_has_basis, f"bare number at {path}"
        return
    if isinstance(x, dict):
        has = "basis" in x
        if has:
            assert x["basis"] in BASIS, f"bad basis at {path}"
        for k, v in x.items():
            _numbers_have_basis(v, f"{path}.{k}", has and k == "value")
    if isinstance(x, list):
        for i, v in enumerate(x):
            _numbers_have_basis(v, f"{path}[{i}]", False)


def test_chat_events_contract():
    lines = (C / "chat_events.example.jsonl").read_text().splitlines()
    events = [json.loads(line) for line in lines if line.strip()]
    assert {e["type"] for e in events} == EVENT_TYPES
    assert events[0]["type"] == "plan" and events[-1]["type"] == "final"
    ids = [e["id"] for e in events]
    assert len(ids) == len(set(ids))
    for e in events:
        assert {"id", "ts", "type"} <= set(e) and e["type"] in EVENT_TYPES
        _numbers_have_basis(e, e["id"])
