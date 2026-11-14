"""Server-side Matterport Model API client (PLAN 4.3).

    python -m engine.matterport <sid> [<sid> ...]     # fetch + cache, prints a one-line summary each
    python -m engine.matterport --refresh <sid>       # ignore the cache

- Three split queries (walls+doors / rooms / room sizes): the full query intermittently returns error.internal.
- Each query retries `internal` errors and network failures up to 4 times with backoff; `not.found` fails at once.
- All calls in the process share one rate limiter (~8 requests/s; the shared keys must stay under 10/s).
- Result cached to data/cache/<sid>.json as {"data": {"model": {name, floors, rooms}}}, the engine's --file format.
Keys come from .env and are never printed.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import threading
import time

import requests
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
API = "https://api.matterport.com/api/models/graph"
MIN_INTERVAL_S = 0.125          # ~8 requests/s across all threads
RETRIES = 4

Q_FLOORS = """query F($id: ID!) { model(id: $id) { name
  floors { id label vertices { id position { x y } }
    edges { id type thickness vertices { id } openings { width type relativeCenter } } } } }"""
Q_ROOMS = """query R($id: ID!) { model(id: $id) {
  rooms { id floor { id } classifications { label confidence } boundary { edges { id } } } } }"""
Q_DIMS = """query D($id: ID!) { model(id: $id) { rooms { id dimensions(units: metric) { areaFloor width depth } } } }"""

load_dotenv(ROOT / ".env")
_lock = threading.Lock()
_last_call = 0.0
_session = requests.Session()


class MatterportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def _throttle() -> None:
    global _last_call
    with _lock:
        wait = _last_call + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()


def _error_code(err: dict) -> str:
    code = (err.get("extensions") or {}).get("code")
    if code:
        return str(code)
    msg = err.get("message", "")
    return "internal" if "internal" in msg else "unknown"


def query(q: str, variables: dict) -> dict:
    """One GraphQL call with retries. Returns `data`. Raises MatterportError."""
    auth = (os.environ.get("MATTERPORT_API_KEY", ""), os.environ.get("MATTERPORT_API_TOKEN", ""))
    if not all(auth):
        raise MatterportError("no_keys", "MATTERPORT_API_KEY / MATTERPORT_API_TOKEN missing from .env")
    last = None
    for attempt in range(RETRIES + 1):
        if attempt:
            time.sleep(min(2 ** (attempt - 1), 8))
        _throttle()
        try:
            r = _session.post(API, json={"query": q, "variables": variables}, auth=auth, timeout=60)
        except requests.RequestException as e:
            last = MatterportError("network", type(e).__name__)
            continue
        if r.status_code in (401, 403):
            raise MatterportError("auth", f"HTTP {r.status_code}")
        if r.status_code >= 500 or r.status_code == 429:
            last = MatterportError("internal", f"HTTP {r.status_code}")
            continue
        try:
            body = r.json()
        except ValueError:                          # e.g. an HTML gateway page: treat as transient
            last = MatterportError("internal", f"non-JSON response (HTTP {r.status_code})")
            continue
        errors = body.get("errors") or []
        if not errors:
            return body.get("data") or {}
        codes = {_error_code(e) for e in errors}
        last = MatterportError(",".join(sorted(codes)), errors[0].get("message", "")[:200])
        if not any("internal" in c for c in codes):
            raise last
    raise last


def fetch_model(sid: str) -> dict:
    """Merge the three split queries into {name, floors, rooms}. Room sizes are optional."""
    floors = query(Q_FLOORS, {"id": sid})["model"]
    rooms = query(Q_ROOMS, {"id": sid})["model"].get("rooms") or []
    try:
        dims = {r["id"]: r.get("dimensions") for r in query(Q_DIMS, {"id": sid})["model"].get("rooms") or []}
    except MatterportError:
        dims = {}                                   # sizes are nice-to-have; walls and doors are not
    for r in rooms:
        if dims.get(r["id"]):
            r["dimensions"] = dims[r["id"]]
    return {"name": floors.get("name"), "floors": floors.get("floors") or [], "rooms": rooms}


def cache_path(sid: str) -> pathlib.Path:
    return CACHE / f"{sid}.json"


def get_model(sid: str, refresh: bool = False) -> dict:
    """Cached model; fetches and caches on a miss."""
    path = cache_path(sid)
    if path.exists() and not refresh:
        return json.loads(path.read_text())["data"]["model"]
    model = fetch_model(sid)
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"data": {"model": model}}))
    os.replace(tmp, path)
    return model


def main(argv: list[str]) -> int:
    refresh = "--refresh" in argv
    sids = [a for a in argv if a != "--refresh"]
    if not sids:
        print(__doc__)
        return 1
    failed = 0
    for sid in sids:
        try:
            m = get_model(sid, refresh)
            n_open = sum(len(e.get("openings") or []) for f in m["floors"] for e in f.get("edges") or [])
            print(f"{sid}: {m['name']!r} floors={len(m['floors'])} rooms={len(m['rooms'])} openings={n_open} -> {cache_path(sid).relative_to(ROOT)}")
        except MatterportError as e:
            failed += 1
            print(f"{sid}: FAILED {e}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
