"""Vision check on defurnished panoramas (PLAN 7.1 `vision`): bathrooms and blocked doors.

    python -m engine.vision demo-main demo-backup ...     # needs Matterport + model keys; results cached

For each unit, targets come from the fit engine (27x42 in chair, as scanned): every bathroom, and every blocked
room's stopping door. Each target gets the nearest panorama of the unit's *defurnished* view (furniture removed);
its four side faces (as a 2x2 grid) and floor face go to the configured vision model with fixed questions:
  bathroom: bathtub / roll-in shower / step-in shower / unclear; grab bars yes/no/unclear
  door:     step or raised threshold yes/no/unclear
Answers are validated in code; anything the picture cannot show is "unclear". Every claim cites its pano id and is
labelled "from defurnished panorama, estimated". Results: data/cache/vision/<sid>.json (+ the images it used).
"""
from __future__ import annotations

import base64
import io
import json
import math
import os
import pathlib
import re
import sys

import requests
from PIL import Image
from shapely.geometry import Point, Polygon

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.fit import analyze_model  # noqa: E402
from engine.matterport import get_model, query  # noqa: E402

FACE_PX = 640
LABEL = "from defurnished panorama, estimated"
Q_VIEW = 'query V($id: ID!) { model(id: $id) { view(type: "matterport.model.defurnished") { id } } }'
Q_PANOS = 'query P($id: ID!) { model(id: $id) { panoLocations { id position { x y z } skybox(resolution: "2k") { children } } } }'
QUESTIONS = {
    "bathroom": {
        "bathing": ("What bathing fixture is visible?", ["bathtub", "roll_in_shower", "step_in_shower", "unclear"]),
        "grab_bars": ("Are grab bars visible near the toilet, tub or shower?", ["yes", "no", "unclear"]),
        "threshold": ("Is there a step or raised threshold at the bathroom doorway or shower entry?", ["yes", "no", "unclear"]),
    },
    "door": {
        "threshold": ("Is there a step or raised threshold at this doorway (a level change you would roll over)?",
                      ["yes", "no", "unclear"]),
    },
}


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def vision_dir() -> pathlib.Path:
    return data_dir() / "cache" / "vision"


def targets(sid: str) -> list[dict]:
    """Bathrooms and blocked doors from the engine (as scanned, 27x42 in)."""
    res = analyze_model(get_model(sid), sid)
    out = []
    for f in res["floors"]:
        doors = {d["edge"]: d for d in f.get("doors", [])}
        for r in f["rooms"]:
            poly = r.get("polygon")
            if r["label"].lower() == "bathroom" and poly:
                out.append({"kind": "bathroom", "room_id": r["room_id"], "room": r["label"], "status": r["status"],
                            "xy": list(Polygon(poly).representative_point().coords[0]), "polygon": poly})
            stop = doors.get(r.get("blocking_door_edge") or "")
            if r["status"] == "blocked" and stop:
                out.append({"kind": "door", "room_id": r["room_id"], "room": r["label"], "status": r["status"],
                            "xy": stop["center"], "door_in": stop["width_in"], "edge": stop["edge"]})
    seen, uniq = set(), []                          # one check per door even if several rooms stop there
    for t in out:
        k = (t["kind"], t.get("edge") or t["room_id"])
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    return uniq


def nearest_pano(panos: list[dict], t: dict) -> tuple[dict, float] | None:
    best = None
    for p in panos:
        pos = p.get("position") or {}
        d = math.hypot(pos.get("x", 1e9) - t["xy"][0], pos.get("y", 1e9) - t["xy"][1])
        inside = t["kind"] == "bathroom" and Polygon(t["polygon"]).buffer(0.3).contains(Point(pos["x"], pos["y"]))
        score = d - (100 if inside else 0)            # prefer a pano inside the bathroom
        if best is None or score < best[2]:
            best = (p, d, score)
    if best is None or (best[1] > (4.0 if t["kind"] == "bathroom" else 3.0) and best[2] > -50):
        return None                                   # too far away to show the target
    return best[0], best[1]


def fetch_faces(pano: dict) -> tuple[Image.Image, Image.Image]:
    urls = (pano.get("skybox") or {}).get("children") or []
    if len(urls) != 6:
        raise RuntimeError("panorama has no 6-face skybox")
    faces = [Image.open(io.BytesIO(requests.get(u, timeout=60).content)).convert("RGB").resize((FACE_PX, FACE_PX))
             for u in urls[1:6]]                      # order: up, 4 sides, down; the ceiling is not needed
    grid = Image.new("RGB", (2 * FACE_PX, 2 * FACE_PX))
    for i, f in enumerate(faces[:4]):
        grid.paste(f, ((i % 2) * FACE_PX, (i // 2) * FACE_PX))
    return grid, faces[4]


def ask(kind: str, room: str, imgs: list[Image.Image]) -> dict:
    from langchain.chat_models import init_chat_model
    from langchain_core.messages import HumanMessage
    qs = QUESTIONS[kind]
    prompt = (f"These are views from one 360-degree panorama of an empty apartment ({room}). Image 1: the four "
              "horizontal directions as a 2x2 grid. Image 2: the floor below the camera. Answer only from what is "
              "visible. If you cannot see it clearly, answer unclear. Reply with JSON only, "
              '{"<key>": {"answer": "...", "note": "<= 20 words on what you see"}} for:\n'
              + "\n".join(f"- {k}: {q} One of: {', '.join(opts)}" for k, (q, opts) in qs.items()))
    blocks = [{"type": "text", "text": prompt}]
    for im in imgs:
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        blocks.append({"type": "image", "base64": base64.b64encode(buf.getvalue()).decode(), "mime_type": "image/jpeg"})
    prov = {"google": "google_genai", "anthropic": "anthropic"}[os.environ["MODEL_PROVIDER"].lower()]
    model = init_chat_model(os.environ["MODEL_NAME"], model_provider=prov)
    content = model.invoke([HumanMessage(content=blocks)]).content
    text = content if isinstance(content, str) else "".join(p.get("text", "") for p in content if isinstance(p, dict))
    m = re.search(r"\{.*\}", text, re.S)
    try:
        raw = json.loads(m.group(0)) if m else {}
    except ValueError:
        raw = {}
    if not isinstance(raw, dict) or not any(k in raw for k in qs):
        raise RuntimeError("vision model gave no usable answer")
    out = {}
    for k, (q, opts) in qs.items():
        v = raw.get(k) if isinstance(raw.get(k), dict) else {}
        a = str(v.get("answer", "unclear")).lower().replace(" ", "_").replace("-", "_")
        out[k] = {"question": q, "answer": a if a in opts else "unclear", "note": str(v.get("note", ""))[:160]}
    return out


def check_unit(sid: str, refresh: bool = False) -> dict:
    """Vision findings for a unit's bathrooms and blocked doors (cached)."""
    path = vision_dir() / f"{sid}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    if len(get_model(sid).get("floors") or []) > 1:
        return {"sid": sid, "error": "multi-floor unit: panoramas cannot be matched to a storey, not checked"}
    view = ((query(Q_VIEW, {"id": sid}).get("model") or {}).get("view") or {}).get("id")
    if not view:
        return {"sid": sid, "error": "no defurnished view for this model"}
    panos = (query(Q_PANOS, {"id": view}).get("model") or {}).get("panoLocations") or []
    vision_dir().mkdir(parents=True, exist_ok=True)
    items, images = [], []
    for t in targets(sid):
        hit = nearest_pano(panos, t)
        if not hit:
            items.append({**{k: t[k] for k in ("kind", "room_id", "room")}, "pano_id": None,
                          "answers": {k: {"question": q, "answer": "unclear", "note": "no panorama near this spot"}
                                      for k, (q, _) in QUESTIONS[t["kind"]].items()}, "label": LABEL})
            continue
        pano, dist = hit
        grid, floor = fetch_faces(pano)
        name = f"{sid}_{pano['id']}.jpg"
        if name not in images:                        # evidence = exactly what the model saw: sides grid + floor
            sheet = Image.new("RGB", (3 * FACE_PX, 2 * FACE_PX), "white")
            sheet.paste(grid, (0, 0))
            sheet.paste(floor, (2 * FACE_PX, FACE_PX // 2))
            sheet.save(vision_dir() / name, quality=80)
            images.append(name)
        items.append({**{k: t[k] for k in ("kind", "room_id", "room")},
                      **({"door_in": t["door_in"]} if "door_in" in t else {}),
                      "pano_id": pano["id"], "pano_distance_m": round(dist, 2), "image": name,
                      "answers": ask(t["kind"], t["room"], [grid, floor]), "label": LABEL})
    res = {"sid": sid, "view": "matterport.model.defurnished", "model": os.environ.get("MODEL_NAME"), "chair_in": [27.0, 42.0],
           "items": items, "images": images}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(res, indent=1))
    os.replace(tmp, path)
    return res


def main(argv: list[str]) -> int:
    from dotenv import load_dotenv
    load_dotenv(os.environ.get("ROLLIN_ENV_FILE") or ROOT / ".env")
    from engine.demo_units import resolve
    for sid in map(resolve, argv):
        try:
            r = check_unit(sid)
            print(sid, r.get("error") or [(i["kind"], i["room"], i["pano_id"],
                                           {k: v["answer"] for k, v in i["answers"].items()}) for i in r["items"]])
        except Exception as e:                        # report and continue
            print(sid, "FAILED", type(e).__name__, str(e)[:200])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
