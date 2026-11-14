"""Outside check from Vexcel aerial imagery (PLAN 7.1 `outside`, CoStar track).

    python -m engine.vexcel demo-main demo-backup      # clip + findings for units in the index

aerial_check(lat, lon) clips a Vexcel orthophoto (7.5 cm/px class) around the point, caches the JPEG in
data/cache/, and asks a vision model a fixed set of questions about what is visible from above. Every finding
is labelled "from aerial, estimated"; anything an overhead photo cannot show (steps, door widths, elevators)
is answered "unclear" rather than guessed. Keys come from .env and are never printed.
"""
from __future__ import annotations

import base64
import csv
import json
import math
import os
import pathlib
import re
import sys

import requests
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[1]
load_dotenv(os.environ.get("ROLLIN_ENV_FILE") or ROOT / ".env")
API = "https://api.vexcelgroup.com/v2/ortho/extract"
LAYERS = "urban,urban-r,wide-area,urban-g"
HALF_M = 40.0                                   # clip = 80 m square around the point

QUESTIONS = {
    "accessible_parking": "Are accessible parking stalls (blue paint / wheelchair symbol / striped access aisle) visible?",
    "curb_ramps": "Are curb ramps or flush curbs visible between the parking/street and the walkways?",
    "walkways_to_buildings": "Are continuous paved walkways visible from parking to building entrances?",
    "exterior_stairs": "Are exterior stairs visible on the buildings (external staircases to upper floors)?",
    "multi_storey": "Do the buildings look multi-storey (two or more floors)?",
}
PROMPT = ("You are looking at a top-down aerial orthophoto (about 80 m across) centred on an apartment building. "
          "For each question answer exactly one of: yes, no, unclear. Answer unclear whenever an overhead photo cannot "
          "show it reliably. Add a short note (max 20 words) on what you actually see. Do not guess door widths, "
          "steps at doors, or elevators. Reply with JSON only: "
          '{"<key>": {"answer": "yes|no|unclear", "note": "..."}} for these keys:\n'
          + "\n".join(f"- {k}: {q}" for k, q in QUESTIONS.items()))


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def key_for(lat: float, lon: float) -> str:
    return f"aerial_{lat:.5f}_{lon:.5f}".replace("-", "m").replace(".", "p")


def square_wkt(lat: float, lon: float, half_m: float = HALF_M) -> str:
    dlat = half_m / 111_320
    dlon = half_m / (111_320 * math.cos(math.radians(lat)))
    ring = [(lon - dlon, lat - dlat), (lon + dlon, lat - dlat), (lon + dlon, lat + dlat),
            (lon - dlon, lat + dlat), (lon - dlon, lat - dlat)]
    return "POLYGON((" + ", ".join(f"{x:.7f} {y:.7f}" for x, y in ring) + "))"


def clip(lat: float, lon: float) -> pathlib.Path:
    """Cached orthophoto JPEG around (lat, lon)."""
    path = data_dir() / "cache" / f"{key_for(lat, lon)}.jpg"
    if path.exists():
        return path
    r = requests.post(API, headers={"X-API-KEY": os.environ.get("VEXCEL_API_KEY", "")}, timeout=90,
                      json={"wkt": square_wkt(lat, lon), "srid": 4326, "layer": LAYERS,
                            "crop": "bounding_box", "image-format": "jpeg"})
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        raise RuntimeError(f"Vexcel ortho/extract failed: HTTP {r.status_code} {r.text[:160]!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return path


def ask_vision(jpeg: bytes) -> dict:
    """Fixed questions about the clip, answered by the configured model. Returns {key: {answer, note}}."""
    from langchain.chat_models import init_chat_model
    from langchain_core.messages import HumanMessage
    provider = {"google": "google_genai", "anthropic": "anthropic"}[os.environ["MODEL_PROVIDER"].lower()]
    model = init_chat_model(os.environ["MODEL_NAME"], model_provider=provider)
    msg = HumanMessage(content=[{"type": "text", "text": PROMPT},
                                {"type": "image", "base64": base64.b64encode(jpeg).decode(), "mime_type": "image/jpeg"}])
    content = model.invoke([msg]).content
    text = content if isinstance(content, str) else "".join(p.get("text", "") for p in content if isinstance(p, dict))
    m = re.search(r"\{.*\}", text, re.S)
    try:
        raw = json.loads(m.group(0)) if m else {}
    except ValueError:
        raw = {}
    if not isinstance(raw, dict) or not any(k in raw for k in QUESTIONS):
        raise RuntimeError("vision model gave no usable answer")   # not cached; reported as a failure, never as findings
    out = {}
    for k in QUESTIONS:
        v = raw.get(k) or {}
        ans = str(v.get("answer", "unclear")).lower()
        out[k] = {"answer": ans if ans in ("yes", "no", "unclear") else "unclear", "note": str(v.get("note", ""))[:160]}
    return out


def aerial_check(lat: float, lon: float) -> dict:
    """Clip, cache and describe what is visible around (lat, lon). Cached per point."""
    base = data_dir() / "cache" / key_for(lat, lon)
    findings_path = base.with_suffix(".findings.json")
    if findings_path.exists():
        return json.loads(findings_path.read_text())
    img = clip(lat, lon)
    answers = ask_vision(img.read_bytes())
    res = {"lat": lat, "lon": lon, "clip_m": 2 * HALF_M, "image": img.name, "source": "Vexcel ortho (from aerial)",
           "model": os.environ.get("MODEL_NAME"),
           "findings": [{"item": k, "question": QUESTIONS[k], "answer": v["answer"], "note": v["note"],
                         "basis": "estimated", "label": "from aerial, estimated"} for k, v in answers.items()]}
    findings_path.write_text(json.dumps(res, indent=1))
    return res


def unit_location(sid: str) -> tuple[float, float] | None:
    with open(data_dir() / "raw" / "models_index.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["sid"] == sid and r["lat"] and r["lon"]:
                return float(r["lat"]), float(r["lon"])
    return None


def aerial_check_unit(sid: str) -> dict:
    """aerial_check for a unit, located from data/raw/models_index.csv; links the image to the sid."""
    loc = unit_location(sid)
    if loc is None:
        return {"sid": sid, "error": "no location for this unit"}
    res = {"sid": sid, **aerial_check(*loc)}
    link = data_dir() / "cache" / f"aerial_{sid}.json"
    link.write_text(json.dumps({"sid": sid, "image": res["image"], "findings_file": key_for(*loc) + ".findings.json"}))
    return res


def main(argv: list[str]) -> int:
    sys.path.insert(0, str(ROOT))
    from engine.demo_units import resolve
    for sid in map(resolve, argv):
        try:
            res = aerial_check_unit(sid)
            print(sid, res.get("error") or [(f["item"], f["answer"]) for f in res["findings"]])
        except Exception as e:                       # report and continue with the next unit
            print(sid, "FAILED", type(e).__name__, str(e)[:200])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
