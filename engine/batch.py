"""Batch: apartment units near a point -> fetch -> fit engine -> ranked data/batch/index.json.

    python -m engine.batch                          # 8 km around Texas Medical Center, 27x42 in chair
    python -m engine.batch --limit 200 --workers 3 --radius-km 8 --w 27 --l 42

Centre: Texas Medical Center, Houston, 29.7095 N, -95.3982 W (latitude.to; Wikipedia's district point
29.7062, -95.4088 is ~1 km west). Candidates: rows of data/raw/models_index.csv with coordinates inside the
radius whose name looks like a unit ("<unit name>", "2BR, 2BA", "Studio"), nearest first.
Each unit is run as scanned and with offset hinges. Resumable: units with a result file are not refetched.
Outputs (gitignored): data/batch/results/<sid>.json, data/batch/index.json (rewritten as it goes).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import pathlib
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.fit import analyze_model  # noqa: E402
from engine.matterport import MatterportError, get_model  # noqa: E402
from engine.summary import rank, room_counts, score, sentence, unit_row  # noqa: E402

INDEX_CSV = ROOT / "data" / "raw" / "models_index.csv"
OUT = ROOT / "data" / "batch"
RESULTS = OUT / "results"
TMC = (29.7095, -95.3982)
ENGINE_REV = 3                       # bump when engine output changes; stale results are recomputed
UNIT_NAME = re.compile(r"^\s*(studio|\d+\s*br\b|\d+\s*bed)", re.I)


def km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def candidates(center: tuple[float, float], radius_km: float) -> list[dict]:
    rows = []
    with open(INDEX_CSV, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not (r["lat"] and r["lon"]) or not UNIT_NAME.search(r["name"]):
                continue
            d = km(*center, float(r["lat"]), float(r["lon"]))
            if d <= radius_km:
                rows.append({"sid": r["sid"], "lat": float(r["lat"]), "lon": float(r["lon"]),
                             "distance_km": round(d, 2), "name": r["name"]})
    return sorted(rows, key=lambda r: (r["distance_km"], r["sid"]))


def run_one(c: dict, w: float, l: float) -> dict:
    path = RESULTS / f"{c['sid']}.json"
    if path.exists():                     # resume only if it was computed the same way for the same chair
        rec = json.loads(path.read_text())
        if rec.get("engine_rev") == ENGINE_REV and rec["row"].get("chair_in") == [w, l]:
            rec["row"]["distance_km"] = c["distance_km"]
            return rec
    model = get_model(c["sid"])
    scanned = analyze_model(model, c["sid"], w, l, hinges=False)
    hinged = analyze_model(model, c["sid"], w, l, hinges=True)
    row = unit_row(scanned, c["lat"], c["lon"], source="batch")
    hc = room_counts(hinged)
    row.update({"distance_km": c["distance_km"],
                "with_hinges": {"score": score(hc), "counts": hc, "summary": sentence(hinged, hc)}})
    row["basis"]["distance_km"] = "estimated"
    notes = [f["note"] for f in scanned["floors"] if f.get("note")]
    row["usable"] = sum(row["counts"].values()) > 0       # no measured rooms -> no verdict, never "score 0"
    # (a chair that fits nowhere still gets rooms, all blocked: see fit.analyze_floor)
    if notes:
        row["notes"] = notes
    rec = {"row": row, "engine_rev": ENGINE_REV, "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    RESULTS.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, path)
    return rec


def write_index(meta: dict, rows: list[dict], failed: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    usable = [r for r in rows if r.get("usable", True)]
    no_data = [{"sid": r["sid"], "name": r["name"], "notes": r.get("notes", [])} for r in rows if not r.get("usable", True)]
    doc = {**meta, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "processed": len(rows), "ranked": len(usable), "no_data": no_data, "failed": failed,
           "units": rank(usable)}
    tmp = OUT / "index.json.tmp"
    tmp.write_text(json.dumps(doc, indent=1))
    os.replace(tmp, OUT / "index.json")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lat", type=float, default=TMC[0])
    ap.add_argument("--lon", type=float, default=TMC[1])
    ap.add_argument("--radius-km", type=float, default=8.0)
    ap.add_argument("--w", type=float, default=27.0, help="chair width, inches")
    ap.add_argument("--l", type=float, default=42.0, help="chair length, inches")
    ap.add_argument("--limit", type=int, default=0, help="max units (0 = all candidates)")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)

    cands = candidates((a.lat, a.lon), a.radius_km)
    if a.limit:
        cands = cands[:a.limit]
    meta = {"center": {"lat": a.lat, "lon": a.lon, "label": "Texas Medical Center, Houston"},
            "radius_km": a.radius_km, "chair_in": [a.w, a.l], "candidates": len(cands),
            "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    print(f"{len(cands)} candidate units within {a.radius_km} km; chair {a.w}x{a.l} in; {a.workers} workers", flush=True)

    rows, failed, lock, t0 = [], [], threading.Lock(), time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(run_one, c, a.w, a.l): c for c in cands}
        for i, fut in enumerate(as_completed(futs), 1):
            c = futs[fut]
            try:
                rec = fut.result()
                with lock:
                    rows.append(rec["row"])
            except (MatterportError, KeyError, ValueError, TypeError) as e:
                with lock:
                    failed.append({"sid": c["sid"], "error": f"{type(e).__name__}: {str(e)[:160]}"})
            except Exception as e:  # engine edge cases on odd scans: record, keep going
                with lock:
                    failed.append({"sid": c["sid"], "error": f"{type(e).__name__}: {str(e)[:160]}"})
            if i % 10 == 0 or i == len(cands):
                with lock:
                    write_index(meta, rows, failed)
                ranked = sum(1 for r in rows if r.get("usable", True))
                print(f"[{i}/{len(cands)}] ranked={ranked} no_data={len(rows) - ranked} failed={len(failed)} "
                      f"elapsed={time.time() - t0:.0f}s", flush=True)
    write_index(meta, rows, failed)
    ranked = sum(1 for r in rows if r.get("usable", True))
    print(f"done: {ranked} ranked, {len(rows) - ranked} no data, {len(failed)} failed -> "
          f"{(OUT / 'index.json').relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
