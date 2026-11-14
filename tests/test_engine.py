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

DEMO = pathlib.Path(__file__).resolve().parents[1] / "data/cache/demo-backup.json"

@pytest.mark.skipif(not DEMO.exists(), reason="real data is local-only (data/cache, gitignored)")
def test_demo_unit_hinges_flip_bedroom():
    before = run(DEMO)
    after = run(DEMO, "--hinges")
    bed = lambda r: [x for x in r["floors"][0]["rooms"] if x["label"] == "Bedroom"]
    assert [x["status"] for x in bed(before)] == ["blocked"]
    assert [x["status"] for x in bed(after)] == ["reachable"]
    baths = lambda r: {x["status"] for x in r["floors"][0]["rooms"] if x["label"] == "Bathroom"}
    assert baths(before) == {"blocked"} and baths(after) == {"blocked"}

def test_output_matches_contract_keys():
    r = run(ROOT / "tests/synthetic_1br.json")
    ex = json.load(open(ROOT / "contracts/unit_result.example.json"))
    assert set(r) == set(ex)
    assert set(r["floors"][0]) == set(ex["floors"][0])
    assert set(r["floors"][0]["rooms"][0]) == set(ex["floors"][0]["rooms"][0])
