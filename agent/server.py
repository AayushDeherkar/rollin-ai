"""Rollin' API (PLAN 7.2), served from local data only: no Matterport calls at request time.

    uvicorn agent.server:app --port 8000 --reload

GET /api/units          ranked list from data/batch/index.json (contract: contracts/units_list.example.json)
GET /api/units/{sid}    engine result from data/cache/<sid>.json (contract: contracts/unit_result.example.json)
GET /api/health         what data is loaded
GET /api/aerial/{sid}[/findings]   cached Vexcel clip + labelled findings (engine/vexcel.py)
GET /api/vision/{sid}[/{pano_id}]  cached panorama checks + the image each is based on (engine/vision.py)
POST /api/chat, POST /api/approve   agent event stream and approval gate (agent/chat.py)
GET /api/outbox, POST /api/outbox/{id}/delivered, GET /api/events   delivery by the bridge (agent/outbox.py)
POST /api/answers   a leasing-office reply; answered unknown rooms get basis "asked"
GET /api/insights   chair-size sweep aggregates and sourced chair presets (tracked files in data/)

ROLLIN_DATA_DIR overrides the data folder (default: <repo>/data).
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import re
import sys
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.fit import analyze_model  # noqa: E402
from agent.chat import router as chat_router  # noqa: E402
from agent import outbox  # noqa: E402

SID = re.compile(r"^[A-Za-z0-9_]{3,40}$")
BEDS = re.compile(r"(\d+)\s*(?:br\b|bed)", re.I)

app = FastAPI(title="Rollin' API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(chat_router)
app.include_router(outbox.router)


def _attach_live_agent() -> None:
    """POST /api/chat runs the deepagents orchestrator when a model is configured in .env."""
    from agent import chat
    from agent.agent import configured, run_agent
    if configured():
        chat.live_runner = run_agent


_attach_live_agent()


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def load_index() -> dict:
    path = data_dir() / "batch" / "index.json"
    if not path.exists():
        raise HTTPException(503, "no batch index yet: run `python -m engine.batch`")
    return json.loads(path.read_text())


def beds_of(name: str | None) -> int | None:
    """Bedrooms parsed from a unit name; Studio = 0; None if the name does not say."""
    if not name:
        return None
    if re.match(r"^\s*studio", name, re.I):
        return 0
    m = BEDS.search(name)
    return int(m.group(1)) if m else None


def km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


@app.get("/api/health")
def health() -> dict:
    d = data_dir()
    idx = d / "batch" / "index.json"
    meta = {}
    if idx.exists():
        doc = json.loads(idx.read_text())
        meta = {k: doc.get(k) for k in ("candidates", "processed", "ranked", "updated_at", "chair_in")}
    models = [p for p in (d / "cache").glob("*.json") if not p.name.startswith("aerial_")] if (d / "cache").exists() else []
    from engine.demo_pack import demo_status
    return {"ok": True, "cached_models": len(models), "batch": meta or None, "demo": demo_status()}


@app.get("/api/units")
def units(lat: float | None = None, lon: float | None = None, radius_km: float | None = Query(None, gt=0),
          beds: int | None = Query(None, ge=0), w: float | None = Query(None, gt=0), l: float | None = Query(None, gt=0),
          hinges: bool = False) -> dict:
    doc = load_index()
    chair = doc.get("chair_in") or [27.0, 42.0]
    if (w is not None and abs(w - chair[0]) > 1e-6) or (l is not None and abs(l - chair[1]) > 1e-6):
        raise HTTPException(422, f"the ranked list was computed for a {chair[0]:g}x{chair[1]:g} in chair; "
                                 f"use /api/units/{{sid}}?w=&l= for other sizes")
    c_lat = lat if lat is not None else doc["center"]["lat"]
    c_lon = lon if lon is not None else doc["center"]["lon"]
    rows = []
    for u in doc.get("units", []):
        u = dict(u)
        if u.get("lat") is not None and u.get("lon") is not None:
            u["distance_km"] = round(km(c_lat, c_lon, u["lat"], u["lon"]), 2)
        if radius_km is not None and (u.get("distance_km") is None or u["distance_km"] > radius_km):
            continue
        if beds is not None and beds_of(u.get("name")) != beds:
            continue
        if hinges and u.get("with_hinges"):
            h = u["with_hinges"]
            u["score"], u["counts"] = h["score"], h["counts"]
            u["summary"] = h.get("summary") or "with offset hinges (summary not computed; rerun the batch)"
            u["scenario"] = "offset hinges on every door"
        rows.append(u)
    rows.sort(key=lambda r: (-r["score"], r["counts"]["blocked"], r.get("distance_km") or 0, r["sid"]))
    return {"query": {"lat": c_lat, "lon": c_lon, "radius_km": radius_km, "beds": beds,
                      "w": chair[0], "l": chair[1], "hinges": hinges},
            "total": len(rows), "units": rows,
            "source": {"kind": "batch", "updated_at": doc.get("updated_at"), "processed": doc.get("processed"),
                       "no_data": len(doc.get("no_data", []))}}


def _aerial(sid: str) -> tuple[pathlib.Path, pathlib.Path]:
    if not SID.match(sid):
        raise HTTPException(400, "bad model id")
    link = data_dir() / "cache" / f"aerial_{sid}.json"
    if not link.exists():
        raise HTTPException(404, f"no aerial check cached for {sid}; run `python -m engine.vexcel {sid}`")
    meta = json.loads(link.read_text())
    return data_dir() / "cache" / meta["image"], data_dir() / "cache" / meta["findings_file"]


@app.get("/api/aerial/{sid}")
def aerial_image(sid: str) -> FileResponse:
    """Cached Vexcel orthophoto around the unit's building (from aerial; imagery (c) Vexcel Imaging)."""
    img, _ = _aerial(sid)
    return FileResponse(img, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/aerial/{sid}/findings")
def aerial_findings(sid: str) -> dict:
    """What is visible from above, every answer labelled 'from aerial, estimated'."""
    _, findings = _aerial(sid)
    return {"sid": sid, "image_url": f"/api/aerial/{sid}", **json.loads(findings.read_text())}


@app.get("/api/vision/{sid}")
def vision(sid: str) -> dict:
    """Panorama checks for a unit (bathroom fixtures, thresholds); every answer is an estimate citing a pano id."""
    if not SID.match(sid):
        raise HTTPException(400, "bad model id")
    p = data_dir() / "cache" / "vision" / f"{sid}.json"
    if not p.exists():
        raise HTTPException(404, f"no vision check cached for {sid}; run `python -m engine.vision {sid}`")
    return json.loads(p.read_text())


@app.get("/api/vision/{sid}/{pano_id}")
def vision_image(sid: str, pano_id: str) -> FileResponse:
    """The defurnished panorama views (2x2 grid) a vision answer is based on."""
    if not SID.match(sid) or not re.match(r"^[A-Za-z0-9]{3,40}$", pano_id):
        raise HTTPException(400, "bad id")
    img = data_dir() / "cache" / "vision" / f"{sid}_{pano_id}.jpg"
    if not img.exists():
        raise HTTPException(404, "image not cached")
    return FileResponse(img, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@lru_cache(maxsize=256)
def _fit(sid: str, w: float, l: float, hinges: bool, mtime: float) -> dict:
    path = data_dir() / "cache" / f"{sid}.json"
    model = json.loads(path.read_text())["data"]["model"]
    return analyze_model(model, sid, w, l, hinges)


@app.get("/api/units/{sid}")
def unit(sid: str, w: float = Query(27.0, gt=0, le=60), l: float = Query(42.0, gt=0, le=80), hinges: bool = False) -> dict:
    if not SID.match(sid):
        raise HTTPException(400, "bad model id")
    path = data_dir() / "cache" / f"{sid}.json"
    if not path.exists():
        raise HTTPException(404, f"{sid} is not cached; run `python -m engine.matterport {sid}`")
    return outbox.apply_answers(_fit(sid, w, l, hinges, path.stat().st_mtime), sid)


class AnswerIn(BaseModel):
    text: str = ""
    outbox_id: str | None = None
    sid: str | None = None
    answers: list[dict] = Field(default_factory=list)
    sender: str | None = Field(None, alias="from")


@app.post("/api/answers")
def answers(body: AnswerIn) -> dict:
    """Log a leasing-office reply. Name the queued message (`outbox_id`) or the unit (`sid`); give the reply `text`
    and optionally structured `answers: [{room, clear_width_in?, answer?}]`. Answered unknown rooms become basis
    "asked" (source landlord) in GET /api/units/{sid}; the engine's status is never changed by an answer."""
    rec, questions = {}, []
    if body.outbox_id:
        if not outbox.OUTBOX_ID.match(body.outbox_id):
            raise HTTPException(400, "bad outbox id")
        p = data_dir() / "outbox" / f"{body.outbox_id}.json"
        rec = outbox._read(p) if p.exists() else None
        if rec is None:
            raise HTTPException(404, f"no queued message {body.outbox_id}")
        questions = rec.get("questions") or []
    sid = body.sid or rec.get("sid")
    if not sid:
        raise HTTPException(422, "give sid, or an outbox_id whose message names its unit")
    if not SID.match(sid):
        raise HTTPException(400, "bad model id")
    if not body.text.strip() and not body.answers:
        raise HTTPException(422, "text or answers is required")
    path = data_dir() / "cache" / f"{sid}.json"
    if not path.exists():
        raise HTTPException(404, f"{sid} is not cached")
    chair = [27.0, 42.0]                            # unknown rooms (no measured door) do not depend on the chair
    fit = _fit(sid, float(chair[0]), float(chair[1]), False, path.stat().st_mtime)
    rooms = [r for f in fit.get("floors", []) for r in f.get("rooms", [])]
    logged = outbox.log_answer(sid, rooms, body.text, body.answers, body.outbox_id, questions, body.sender,
                               rec.get("run_id"))
    return {"answer_id": logged["id"], "sid": sid, "rooms": logged["rooms"], "unmatched": logged["unmatched"]}


def _tracked_json(name: str):
    """A tracked file in <repo>/data (aggregates and sourced presets only; never real unit data)."""
    p = ROOT / "data" / name
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@app.get("/api/insights")
def insights() -> dict:
    """Aggregate chair-size sweep (data/insights.json, from `python -m engine.sweep`; no unit ids) and sourced chair
    presets (data/chair_presets.json: name, width, length, source)."""
    agg = _tracked_json("insights.json")
    presets = _tracked_json("chair_presets.json")
    return {"sweep": agg, "chair_presets": (presets or {}).get("presets", []),
            "note": None if agg else "no sweep yet: run `python -m engine.sweep`"}
