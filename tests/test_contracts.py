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
        assert set(u["with_hinges"]) == {"score", "counts", "summary"}
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


def test_v2_blocked_rooms_drive_to_the_blocking_door():
    r = run_fit("synthetic_demo")
    floor = r["floors"][0]
    doors = {d["edge"]: d for d in floor["doors"]}
    for room in floor["rooms"]:
        assert "blocking_door_edge" in room
        if room["status"] == "blocked":
            assert room["blocking_door_edge"] in doors and room["path"]
            end, door = room["path"][-1], doors[room["blocking_door_edge"]]["center"]
            assert ((end[0] - door[0]) ** 2 + (end[1] - door[1]) ** 2) ** 0.5 < 0.75    # stops at the door
        else:
            assert room["blocking_door_edge"] is None
        if room["turning_space"]:
            assert len(room["turning_space"]["center"]) == 2


def test_v2_hinges_example_bedroom_has_path_and_no_blocking_door():
    bed = lambda f: next(x for x in load(f)["floors"][0]["rooms"] if x["label"] == "Bedroom")
    before, after = bed("unit_result.example.json"), bed("unit_result.hinges.example.json")
    assert before["blocking_door_edge"] and before["path"]
    assert after["blocking_door_edge"] is None and after["path"]

def test_v2_blocking_door_found_through_open_passage():
    import copy
    from engine.fit import analyze_model
    m = copy.deepcopy(json.loads((ROOT / "tests/synthetic_demo.json").read_text())["data"]["model"])
    # split the bedroom with an open (invisible) passage: bed -> bed_b; bed_b has no door of its own
    f = m["floors"][0]
    f["vertices"] += [{"id": "m1", "position": {"x": 4.5, "y": 4}}, {"id": "m2", "position": {"x": 4.5, "y": 7}}]
    edges = {e["id"]: e for e in f["edges"]}
    edges["e_cg"]["vertices"] = [{"id": "m1"}, {"id": "g"}]
    edges["e_cg"]["openings"][0]["relativeCenter"] = 0.5
    edges["e_ef"]["vertices"] = [{"id": "m2"}, {"id": "f"}]
    f["edges"] += [{"id": "e_cm", "type": "wall", "thickness": 0.12, "vertices": [{"id": "c"}, {"id": "m1"}], "openings": []},
                   {"id": "e_em", "type": "wall", "thickness": 0.15, "vertices": [{"id": "e"}, {"id": "m2"}], "openings": []},
                   {"id": "e_mm", "type": "invisible", "thickness": 0.0, "vertices": [{"id": "m1"}, {"id": "m2"}], "openings": []}]
    rooms = {r["id"]: r for r in m["rooms"]}
    rooms["living"]["boundary"]["edges"].append({"id": "e_cm"})
    rooms["bed"]["boundary"]["edges"] = [{"id": "e_cg"}, {"id": "e_mm"}, {"id": "e_ef"}, {"id": "e_fg"}]
    m["rooms"].append({"id": "bed_b", "floor": {"id": "f1"}, "classifications": [{"label": "Bedroom", "confidence": 0.9}],
                       "boundary": {"edges": [{"id": "e_cm"}, {"id": "e_ce"}, {"id": "e_em"}, {"id": "e_mm"}]}})
    out = analyze_model(m, "split", 27.0, 42.0)
    by = {r["room_id"]: r for r in out["floors"][0]["rooms"]}
    assert by["bed"]["status"] == by["bed_b"]["status"] == "blocked"
    assert by["bed_b"]["blocking_door_edge"] == "e_cg" and by["bed_b"]["path"]

