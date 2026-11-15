"""Chair-size sweep: do chair sizes vary enough to matter?

    python -m engine.sweep                    # usable batch units within 8 km, widths 22..32 in, ~10 workers
    python -m engine.sweep --radius-km 8 --workers 10

For every usable unit in data/batch/index.json within the radius (usable = at least one room with a measured
boundary), the fit engine runs at each chair width from 22 to 32 in (1 in steps), as scanned and with offset hinges.
Chair length is ASSUMED to scale with width in the proportions of the 27x42 in reference chair
(length = width x 42/27, rounded to 0.5 in), so a 22 in chair is 34 in long and a 32 in chair is 50 in long.

Outputs:
  data/batch/sweep/<sid>.json   per-unit results (gitignored: real data)
  data/insights.json            aggregates only, no unit ids, names or coordinates (tracked; served by GET /api/insights)
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.fit import analyze_model  # noqa: E402
from engine.summary import room_counts  # noqa: E402

WIDTHS = tuple(range(22, 33))
REF = (27.0, 42.0)
SWEEP_REV = 1
INSIGHTS = ROOT / "data" / "insights.json"


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def length_for(w: float) -> float:
    return round(w * REF[1] / REF[0] * 2) / 2


def room_type(label: str) -> str:
    """'Bedroom 2' -> 'bedroom'; 'Primary  Bathroom' -> 'primary bathroom'."""
    return re.sub(r"\s+", " ", re.sub(r"[\d#]+", " ", label or "")).strip().lower() or "unlabelled"


def tally(res: dict) -> dict:
    c = room_counts(res)
    return {"full": sum(c.values()) > 0 and c["reachable"] == sum(c.values()), "blocked": c["blocked"],
            "unknown": c["unknown"], "rooms": sum(c.values())}


def detail(res: dict) -> dict:
    """At the reference chair: every room's type and status, and each distinct door that stops the chair."""
    rooms, doors = [], {}
    for f in res.get("floors", []):
        by_edge = {d["edge"]: d for d in f.get("doors", [])}
        for r in f.get("rooms", []):
            rooms.append([room_type(r.get("label")), r["status"]])
            d = by_edge.get(r.get("blocking_door_edge") or "")
            if r["status"] == "blocked" and d and d.get("clear_in_est") is not None:
                doors[f"{f.get('floor')}/{d['edge']}"] = d["clear_in_est"]
    return {"rooms": rooms, "blocking_door_clear_in": sorted(doors.values())}


def sweep_unit(sid: str, model_path: str) -> dict:
    out_path = data_dir() / "batch" / "sweep" / f"{sid}.json"
    if out_path.exists():
        rec = json.loads(out_path.read_text())
        if rec.get("rev") == SWEEP_REV and rec.get("widths") == list(WIDTHS):
            return rec
    model = json.loads(pathlib.Path(model_path).read_text())["data"]["model"]
    rec = {"rev": SWEEP_REV, "widths": list(WIDTHS), "by_width": {}}
    for w in WIDTHS:
        l = length_for(w)
        scanned = analyze_model(model, sid, float(w), l, hinges=False)
        hinged = analyze_model(model, sid, float(w), l, hinges=True)
        rec["by_width"][str(w)] = {"scanned": tally(scanned), "hinges": tally(hinged)}
    ref = analyze_model(model, sid, *REF, hinges=False)
    ref_h = analyze_model(model, sid, *REF, hinges=True)
    rec["reference"] = {"scanned": tally(ref), "hinges": tally(ref_h), **detail(ref)}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, out_path)
    return rec


def units_within(radius_km: float) -> tuple[list[str], dict]:
    doc = json.loads((data_dir() / "batch" / "index.json").read_text())
    sids = [u["sid"] for u in doc.get("units", [])
            if u.get("usable", True) and u.get("distance_km") is not None and u["distance_km"] <= radius_km
            and (data_dir() / "cache" / f"{u['sid']}.json").exists()]
    return sids, doc


def aggregate(recs: list[dict], radius_km: float, center_label: str) -> dict:
    """Counts only: nothing here can identify a unit."""
    n = len(recs)
    rows = []
    for w in WIDTHS:
        s = [r["by_width"][str(w)] for r in recs]
        full = sum(x["scanned"]["full"] for x in s)
        full_h = sum(x["hinges"]["full"] for x in s)
        rows.append({"width_in": w, "length_in": length_for(w), "fully_reachable": full,
                     "fully_reachable_with_hinges": full_h,
                     "unlocked_by_hinges": sum(x["hinges"]["full"] and not x["scanned"]["full"] for x in s),
                     "no_blocked_room": sum(x["scanned"]["blocked"] == 0 for x in s),
                     "no_blocked_room_with_hinges": sum(x["hinges"]["blocked"] == 0 for x in s)})
    ref = [r["reference"] for r in recs]
    all_types = Counter(t for r in ref for t, _ in r["rooms"])
    blocked_types = Counter(t for r in ref for t, st in r["rooms"] if st == "blocked")
    clear = [c for r in ref for c in r["blocking_door_clear_in"]]
    hist = Counter(int(c // 1) for c in clear)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "question": "Do chair sizes vary enough to matter?",
        "scope": {"area": center_label, "radius_km": radius_km, "units": n,
                  "units_means": "usable units in the batch index (at least one room with a measured boundary)"},
        "definitions": {
            "fully_reachable": "every room in the unit is reachable; unknown rooms count as not reached",
            "no_blocked_room": "no room is blocked; rooms may still be unknown",
            "unlocked_by_hinges": "fully reachable with offset hinges on every door but not as scanned",
        },
        "length_rule": {"text": "chair length scales with width in the 27x42 in reference proportions "
                                "(length = width x 42/27, rounded to 0.5 in)", "basis": "assumed"},
        "basis": "estimated",
        "sweep": rows,
        "at_reference_chair": {
            "chair_in": list(REF),
            "fully_reachable": sum(r["scanned"]["full"] for r in ref),
            "unlocked_by_hinges": sum(r["hinges"]["full"] and not r["scanned"]["full"] for r in ref),
            "blocking_room_types": [{"type": t, "blocked": b, "rooms": all_types[t],
                                     "share_blocked": round(b / all_types[t], 3)}
                                    for t, b in blocked_types.most_common(8)],
            "blocking_doors": len(clear),
            "blocking_door_clear_in_histogram": [{"from_in": k, "to_in": k + 1, "doors": hist[k]}
                                                 for k in range(min(hist), max(hist) + 1)] if hist else [],
            "clear_width_basis": "estimated (measured opening minus 5 cm for door leaf and stop)",
        },
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--radius-km", type=float, default=8.0)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--out", default=str(INSIGHTS))
    a = ap.parse_args(argv)
    sids, doc = units_within(a.radius_km)
    print(f"{len(sids)} usable units within {a.radius_km} km; widths {WIDTHS[0]}..{WIDTHS[-1]} in; "
          f"{a.workers} workers", flush=True)
    t0, recs, failed = time.time(), [], 0
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(sweep_unit, s, str(data_dir() / "cache" / f"{s}.json")) for s in sids]
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                recs.append(fut.result())
            except Exception as e:              # odd scans: count, keep going (no ids printed)
                failed += 1
                print(f"failed: {type(e).__name__}", flush=True)
            if i % 25 == 0 or i == len(futs):
                print(f"{i}/{len(futs)} units, {time.time() - t0:.0f} s", flush=True)
    out = aggregate(recs, a.radius_km, (doc.get("center") or {}).get("label") or "batch centre")
    out["scope"]["failed"] = failed
    out["elapsed_s"] = round(time.time() - t0)
    pathlib.Path(a.out).write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
