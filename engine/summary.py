"""Turn one engine result (engine/fit.py JSON) into a ranked-list row for GET /api/units.

Score = share of rooms the chair reaches (reachable / all rooms). Unknown rooms count as not
reached: we never treat a missing door as a pass. Ties rank the unit with fewer blocked rooms first.
"""
from __future__ import annotations

STATUSES = ("reachable", "blocked", "unknown")


def room_counts(result: dict) -> dict[str, int]:
    counts = {s: 0 for s in STATUSES}
    for floor in result.get("floors", []):
        for room in floor.get("rooms", []):
            counts[room["status"]] += 1
    return counts


def score(counts: dict[str, int]) -> float:
    total = sum(counts.values())
    return round(counts["reachable"] / total, 3) if total else 0.0


def sentence(result: dict, counts: dict[str, int]) -> str:
    """One plain-English line; only states what the engine output says."""
    total = sum(counts.values())
    if not total:
        return "no rooms with measured boundaries in the scan"
    parts = [f"{counts['reachable']} of {total} rooms reachable"]
    blocked = [r for f in result["floors"] for r in f.get("rooms", []) if r["status"] == "blocked"]
    if blocked:
        parts.append("blocked: " + ", ".join(r["label"] for r in blocked))
    if counts["unknown"]:
        parts.append(f"{counts['unknown']} unknown (no measured door)")
    return "; ".join(parts)


def unit_row(result: dict, lat: float | None, lon: float | None, source: str = "cache") -> dict:
    counts = room_counts(result)
    return {
        "sid": result["model"], "name": result.get("name"), "lat": lat, "lon": lon,
        "score": score(counts), "counts": counts, "summary": sentence(result, counts),
        "chair_in": result.get("chair_in"), "scenario": result.get("scenario"),
        "basis": {"score": "estimated", "counts": "estimated", "lat_lon": "estimated" if lat is not None else "unknown"},
        "source": source,
    }


def rank(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (-r["score"], r["counts"]["blocked"], r["sid"]))
