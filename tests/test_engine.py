import json, subprocess, sys, pathlib
import pytest
ROOT = pathlib.Path(__file__).resolve().parents[1]

def run(file, *args):
    subprocess.run([sys.executable, str(ROOT / "engine/fit.py"), "--file", str(file), *args],
                   cwd=ROOT, check=True, capture_output=True)
    tag = "_hinges" if "--hinges" in args else ""
    return json.load(open(ROOT / f"out/{pathlib.Path(file).stem}_fit{tag}.json"))

def test_synthetic_blocks_narrow_bathroom():
    r = run(ROOT / "tests/synthetic_1br.json")
    by = {x["label"]: x for x in r["floors"][0]["rooms"]}
    assert by["Bedroom"]["status"] == "reachable"
    assert by["Bathroom"]["status"] == "blocked"
    assert by["Closet"]["status"] == "unknown"

def _demo_main():
    from engine.demo_units import load, path
    d = load()
    sid, expect = d.get("demo-main"), (d.get("expect") or {}).get("demo-main") or {}
    cache = path().parent / "cache" / f"{sid}.json" if sid else None
    return sid, expect, cache


@pytest.mark.skipif(not (_demo_main()[0] and _demo_main()[1] and _demo_main()[2].exists()),
                    reason="real data is local-only: needs data/demo_units.json with an expect block, and the cache")
def test_demo_main_matches_its_expected_story():
    sid, expect, cache = _demo_main()
    before, after = run(cache), run(cache, "--hinges")
    st = lambda r, label: {x["status"] for f in r["floors"] for x in f["rooms"] if x["label"] == label}
    for label in expect.get("flips_with_hinges", []):
        assert "blocked" in st(before, label) and "reachable" in st(after, label)
    for label in expect.get("stays_blocked", []):
        assert st(before, label) == {"blocked"} and st(after, label) == {"blocked"}


def test_output_matches_contract_keys():
    r = run(ROOT / "tests/synthetic_1br.json")
    ex = json.load(open(ROOT / "contracts/unit_result.example.json"))
    assert set(r) == set(ex)
    assert set(r["floors"][0]) == set(ex["floors"][0])
    assert set(r["floors"][0]["rooms"][0]) == set(ex["floors"][0]["rooms"][0])
