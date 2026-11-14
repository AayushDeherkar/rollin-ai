"""Offline demo pack: one zip (outside the repo) with everything the full demo needs on another machine.

    python -m engine.demo_pack                       # -> ~/rollin-share/rollin_demo_pack.zip
    python -m engine.demo_pack --out D:/demo/pack.zip

Contents (all real hackathon data, so never inside the repo or git): the ranked batch index, the replay file, the
Matterport model JSON for the demo units + the replay's units + the top 20 ranked, and for each of those any cached
fit results, aerial clip + findings and vision findings. MANIFEST.json lists what is present and what is missing.
`demo_status()` is the same check, served by GET /api/health.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import zipfile
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]

# main demo first, then backup, alternatives, the fully reachable contrast, the sparse-door example
DEMO_UNITS = ["demo-main", "demo-backup", "redacted-unit-02", "redacted-unit-01", "demo-pass", "demo-sparse"]
TOP_N = 20


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def _replay_sids(d: pathlib.Path) -> list[str]:
    p = d / "replay" / "run.jsonl"
    sids: list[str] = []
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            for s in [(e.get("result") or {}).get("sid"), e.get("sid")] + [u.get("sid") for u in e.get("shortlist") or []]:
                if isinstance(s, str) and s not in sids:
                    sids.append(s)
    return sids


def unit_list(d: pathlib.Path) -> list[str]:
    idx = d / "batch" / "index.json"
    top = [u["sid"] for u in json.loads(idx.read_text()).get("units", [])[:TOP_N]] if idx.exists() else []
    return list(dict.fromkeys(DEMO_UNITS + _replay_sids(d) + top))


def unit_files(d: pathlib.Path, sid: str) -> dict[str, list[pathlib.Path]]:
    cache = d / "cache"
    files: dict[str, list[pathlib.Path]] = {"model": [], "aerial": [], "fit": [], "vision": []}
    if (cache / f"{sid}.json").exists():
        files["model"].append(cache / f"{sid}.json")
    link = cache / f"aerial_{sid}.json"
    if link.exists():
        meta = json.loads(link.read_text())
        files["aerial"] += [p for p in (link, cache / meta["image"], cache / meta["findings_file"]) if p.exists()]
    files["fit"] += sorted((cache / "fit").glob(f"{sid}_*.json")) if (cache / "fit").exists() else []
    vision = cache / "vision" / f"{sid}.json"
    if vision.exists():
        files["vision"].append(vision)
        meta = json.loads(vision.read_text())
        files["vision"] += [cache / "vision" / f for f in meta.get("images", []) if (cache / "vision" / f).exists()]
    return files


def demo_status() -> dict:
    """What the offline demo has and lacks right now (GET /api/health)."""
    d = data_dir()
    units = {}
    for sid in DEMO_UNITS:
        f = unit_files(d, sid)
        units[sid] = {k: bool(v) for k, v in f.items() if k != "fit"}
    missing = [f"{sid}:{k}" for sid, u in units.items() for k, ok in u.items() if not ok]
    for name, p in (("batch index", d / "batch" / "index.json"), ("replay", d / "replay" / "run.jsonl")):
        if not p.exists():
            missing.insert(0, name)
    return {"main_unit": DEMO_UNITS[0], "units": units,
            "index": (d / "batch" / "index.json").exists(), "replay": (d / "replay" / "run.jsonl").exists(),
            "missing": missing}


def build(out: pathlib.Path) -> dict:
    d = data_dir()
    out = out.resolve()
    if ROOT.resolve() in out.parents:
        raise SystemExit(f"refusing to write real data inside the repo: {out}")
    entries: dict[str, pathlib.Path] = {}
    for p in (d / "batch" / "index.json", d / "replay" / "run.jsonl", d / "raw" / "models_index.csv"):
        if p.exists():
            entries[p.relative_to(d).as_posix()] = p
    per_unit = {}
    for sid in unit_list(d):
        f = unit_files(d, sid)
        per_unit[sid] = {k: len(v) for k, v in f.items()}
        for p in sum(f.values(), []):
            entries[p.relative_to(d).as_posix()] = p
    status = demo_status()
    manifest = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "demo_units": DEMO_UNITS, "units": per_unit, "missing_for_demo": status["missing"],
                "files": sorted(entries)}
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for arc, p in sorted(entries.items()):
            z.write(p, f"data/{arc}")
        z.writestr("MANIFEST.json", json.dumps(manifest, indent=1))
        z.writestr("README.txt", README.format(main=DEMO_UNITS[0]))
    return {"zip": str(out), "files": len(entries), "units": len(per_unit), "missing": status["missing"],
            "bytes": out.stat().st_size}


README = """Rollin' offline demo pack (hackathon use only; real Matterport/Vexcel data: do not commit or share publicly).

1. Clone the repo and install:  pip install -r requirements.txt
2. Unzip this pack at the repo root so data/ lands next to engine/ and agent/.
3. Start the API:  uvicorn agent.server:app --port 8000   (GET /api/health lists what is present or missing)
4. No network or model needed for: /api/units, /api/units/{{sid}}, /api/aerial/{{sid}}, and the agent replay
   POST /api/chat?replay=1&speed=2  (every replayed event is marked replay: true; say so on screen).
5. Main demo unit: {main}  (3D tour: https://my.matterport.com/show/?m={main}, needs internet).
"""


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(pathlib.Path.home() / "rollin-share" / "rollin_demo_pack.zip"))
    res = build(pathlib.Path(ap.parse_args(argv).out))
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
