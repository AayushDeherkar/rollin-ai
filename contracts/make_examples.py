"""Regenerate every contracts/*.example.* file from SYNTHETIC apartments only.

    python contracts/make_examples.py

Inputs: tests/synthetic_demo.json (bedroom door 28 in, flips with hinges) and tests/synthetic_1br.json.
All lat/lon values are invented; no real Matterport, CoStar or Vexcel data is used here.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.batch import km  # noqa: E402
from engine.summary import rank, room_counts, score, sentence, unit_row  # noqa: E402

C = ROOT / "contracts"
CHAIR = (27.0, 42.0)
# Invented coordinates near (not at) real addresses; flagged synthetic in every row.
FAKE_LOC = {"synthetic_demo": (29.7101, -95.4012), "synthetic_1br": (29.7203, -95.3891)}


def run_fit(name: str, hinges: bool) -> dict:
    args = [sys.executable, str(ROOT / "engine/fit.py"), "--file", str(ROOT / f"tests/{name}.json"),
            str(CHAIR[0]), str(CHAIR[1])] + (["--hinges"] if hinges else [])
    subprocess.run(args, cwd=ROOT, check=True, capture_output=True)
    return json.loads((ROOT / f"out/{name}_fit{'_hinges' if hinges else ''}.json").read_text())


def batch_row(scanned: dict, hinged: dict) -> dict:
    """Same row shape engine/batch.py writes, from synthetic results."""
    lat, lon = FAKE_LOC[scanned["model"]]
    row = unit_row(scanned, lat, lon, source="batch")
    hc = room_counts(hinged)
    row.update({"distance_km": round(km(29.7106, -95.3990, lat, lon), 2),
                "with_hinges": {"score": score(hc), "counts": hc, "summary": sentence(hinged, hc)},
                "usable": True, "synthetic": True})
    row["basis"]["distance_km"] = "estimated"
    return row


def num(value, basis: str, unit: str | None = None, **extra) -> dict:
    d = {"value": value, "basis": basis}
    if unit:
        d["unit"] = unit
    d.update(extra)
    return d


def room(result: dict, label: str) -> dict:
    return next(r for f in result["floors"] for r in f["rooms"] if r["label"] == label)


def counts_with_basis(row: dict) -> dict:
    return {k: num(v, "estimated") for k, v in row["counts"].items()}


def chat_events(demo: dict, demo_h: dict, other: dict, rows: list[dict]) -> list[dict]:
    w, l = CHAIR
    bed, bed_h, bath, closet = room(demo, "Bedroom"), room(demo_h, "Bedroom"), room(demo, "Bathroom"), room(demo, "Closet")
    bed_door, bath_door = bed["doors"][0], bath["doors"][0]
    hinge_gain = round(bed_h["doors"][0]["clear_in_est"] - bed_door["clear_in_est"], 2)
    chair = {"width": num(w, "asked", "in", source="user"), "length": num(l, "asked", "in", source="user")}
    ev = []

    def add(type_: str, **body):
        ev.append({"id": f"evt_{len(ev) + 1:03d}", "ts": f"2026-11-14T15:02:{len(ev) * 3:02d}Z",
                   "run_id": "run_example_001", "type": type_, **body})

    add("plan", text="Find units near the Medical Center the chair can live in; check bedroom and bathroom access.",
        todos=[{"id": "t1", "text": "Search units within 8 km of the Medical Center", "status": "in_progress"},
               {"id": "t2", "text": "Drive the 27x42 in chair through each floor plan", "status": "pending"},
               {"id": "t3", "text": "Try offset hinges on blocked doors", "status": "pending"},
               {"id": "t4", "text": "Verify every claim and label its basis", "status": "pending"},
               {"id": "t5", "text": "Draft questions for the leasing office (needs approval)", "status": "pending"}])
    add("tool", name="search_units", status="done",
        args={"radius_km": num(8, "asked", "km", source="user"), "chair": chair},
        result={"candidates": num(len(rows), "measured"), "sids": [r["sid"] for r in rows]})
    add("tool", name="run_fit", status="done",
        args={"sid": demo["model"], "chair": chair, "hinges": False},
        result={"scenario": demo["scenario"], "counts": counts_with_basis(unit_row(demo, None, None))})
    add("finding", sid=demo["model"], room_id=bed["room_id"], room=bed["label"], status=bed["status"],
        text=f"Bedroom door is {bed_door['width_in']} in wide; about {bed_door['clear_in_est']} in clear, "
             f"{round(w - bed_door['clear_in_est'], 1)} in short for a {w:g} in chair.",
        numbers={"door_width": num(bed_door["width_in"], "measured", "in"),
                 "clear_width": num(bed_door["clear_in_est"], "estimated", "in"),
                 "shortfall": num(round(w - bed_door["clear_in_est"], 1), "estimated", "in")},
        evidence={"kind": "door", "center": [num(c, "measured", "m") for c in bed_door["center"]]})
    add("tool", name="run_fit", status="done",
        args={"sid": demo["model"], "chair": chair, "hinges": True},
        result={"scenario": demo_h["scenario"], "counts": counts_with_basis(unit_row(demo_h, None, None))})
    add("finding", sid=demo["model"], room_id=bed_h["room_id"], room=bed_h["label"], status=bed_h["status"],
        text="With offset hinges on the bedroom door the chair reaches the bedroom.",
        numbers={"hinge_gain": num(hinge_gain, "assumed", "in"),
                 "clear_width_with_hinges": num(bed_h["doors"][0]["clear_in_est"], "estimated", "in")})
    turn = bath["turning_space"]
    add("finding", sid=demo["model"], room_id=bath["room_id"], room=bath["label"], status=bath["status"],
        text=f"Bathroom door is {bath_door['width_in']} in wide; hinges alone do not make it fit.",
        numbers={"door_width": num(bath_door["width_in"], "measured", "in"),
                 "clear_width": num(bath_door["clear_in_est"], "estimated", "in"),
                 "turning_circle": num(turn["max_circle_in"], "estimated", "in", note="walls only, fixtures not in scan")})
    add("finding", sid=demo["model"], room_id=closet["room_id"], room=closet["label"], status="unknown",
        text="No door was measured for the closet; ask the leasing office.",
        numbers={"door_width": num(None, "unknown", "in")})
    add("tool", name="run_fit", status="done",
        args={"sid": other["model"], "chair": chair, "hinges": False},
        result={"scenario": other["scenario"], "counts": counts_with_basis(unit_row(other, None, None))})
    add("verify", checked=[
        {"claim": "Bedroom door width", "basis": "measured"},
        {"claim": "Clear widths (opening minus 5 cm for leaf and stop)", "basis": "estimated"},
        {"claim": "Offset hinges add about 1.75 in", "basis": "assumed"},
        {"claim": "Bathroom turning circle", "basis": "estimated", "note": "walls only"},
        {"claim": "Closet door width", "basis": "unknown"}],
        questions=["What is the clear width of the closet door?",
                   "Would you install offset (swing-clear) hinges on the bedroom door?",
                   "Is the building entrance step-free, and is there an elevator?"])
    add("approval_needed", action_id="act_example_001", action="send_message",
        to={"label": "Leasing office (demo: teammate's phone)"},
        draft=("Hi, I'm an AI assistant helping a client who uses a 27-inch power chair. "
               "We're interested in the unit's floor plan and have three questions: "
               "1) What is the clear width of the closet door? "
               "2) Would you install offset hinges on the bedroom door? "
               "3) Is the building entrance step-free, and is there an elevator?"),
        reason="Outbound messages always need a person's approval.")
    add("final", awaiting_approval=["act_example_001"],
        shortlist=[{"sid": r["sid"], "name": r["name"], "rank": num(i + 1, "estimated"),
                    "score": num(r["score"], "estimated"), "counts": counts_with_basis(r), "summary": r["summary"]}
                   for i, r in enumerate(rows)],
        text="Two units checked. Neither bathroom fits a 27 in chair as scanned; the demo unit's bedroom works with offset hinges.")
    return ev


def main() -> None:
    demo, demo_h, other = run_fit("synthetic_demo", False), run_fit("synthetic_demo", True), run_fit("synthetic_1br", False)
    (C / "unit_result.example.json").write_text(json.dumps(demo, indent=1) + "\n")
    (C / "unit_result.hinges.example.json").write_text(json.dumps(demo_h, indent=1) + "\n")
    other_h = run_fit("synthetic_1br", True)
    rows = rank([batch_row(r, rh) for r, rh in ((demo, demo_h), (other, other_h))])
    units = {"query": {"lat": 29.7106, "lon": -95.3990, "radius_km": 8.0, "beds": None,
                       "w": CHAIR[0], "l": CHAIR[1], "hinges": False},
             "total": len(rows), "units": rows,
             "source": {"kind": "synthetic example", "updated_at": None, "processed": len(rows), "no_data": 0}}
    (C / "units_list.example.json").write_text(json.dumps(units, indent=1) + "\n")
    events = chat_events(demo, demo_h, other, rows)
    (C / "chat_events.example.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    print(f"wrote 4 contract examples; {len(rows)} units, {len(events)} events")


if __name__ == "__main__":
    main()
