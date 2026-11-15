"""Demo-machine preflight: one command, no internet needed, one PASS/FAIL line per check.

    python -m agent.preflight                       # starts its own API on a free local port, then stops it
    python -m agent.preflight --url http://localhost:8000   # check an API that is already running
    python -m agent.preflight --no-live             # skip the live agent run even if a model key is set

Checks:
  1. data      the demo alias file, the batch index, the replay recording and every demo unit's cached model
  2. api       the API answers /api/health, /api/units, the main demo unit's plan and /api/insights
  3. replay    a replayed chat run streams to `final` and every event says replay: true
  4. live      a live agent run streams to `final` with a shortlist and pauses for approval (only if a model key
               is set; this one needs the model provider, so it fails without internet). Nothing is sent: the run
               stops at the approval step and preflight never approves it.
Real model ids are never printed; demo units are named by alias. Exit code 1 if any check failed.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import time

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import demo_units  # noqa: E402

LIVE_MESSAGE = "Power chair 27 x 42 inches; needs to reach a bedroom and a bathroom; 1 or 2 bedrooms near the Texas Medical Center."


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, bool | None, str]] = []

    def add(self, name: str, ok: bool | None, detail: str) -> None:
        """ok=None means skipped (not a failure)."""
        self.rows.append((name, ok, detail))
        tag = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
        print(f"{tag}  {name:<7} {detail}", flush=True)

    @property
    def failed(self) -> int:
        return sum(ok is False for _, ok, _ in self.rows)


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def check_data(rep: Report) -> None:
    d = data_dir()
    aliases = demo_units.load()
    missing_alias = [a for a in demo_units.ALIASES if not isinstance(aliases.get(a), str)]
    rep.add("data", not missing_alias, "demo_units.json has all four aliases" if not missing_alias else
            f"demo_units.json is missing {', '.join(missing_alias)} (get the file from a teammate)")
    idx = d / "batch" / "index.json"
    try:
        n = len(json.loads(idx.read_text()).get("units", []))
        rep.add("data", n > 0, f"batch index: {n} ranked units")
    except (OSError, ValueError):
        rep.add("data", False, "batch index missing or unreadable (data/batch/index.json)")
    rec = d / "replay" / "run.jsonl"
    rep.add("data", rec.exists(), "replay recording present" if rec.exists() else
            "no data/replay/run.jsonl: replay falls back to the synthetic example")
    from agent.outbox import archive_unlinked
    stale = archive_unlinked(dry_run=True)
    rep.add("data", not stale, "outbox: no stale messages" if not stale else
            f"outbox: {len(stale)} pending message(s) with no unit; run `python -m agent.outbox clean`")
    for a in demo_units.ALIASES:
        sid = aliases.get(a)
        if isinstance(sid, str):
            ok = (d / "cache" / f"{sid}.json").exists()
            rep.add("data", ok, f"{a}: model cached" if ok else f"{a}: model NOT cached (data/cache)")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_api(port: int) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-m", "uvicorn", "agent.server:app", "--host", "127.0.0.1",
                             "--port", str(port), "--log-level", "warning"], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def wait_up(url: str, proc: subprocess.Popen | None, timeout_s: float = 90) -> str | None:
    """None when /api/health answers; otherwise why not."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if proc is not None and proc.poll() is not None:
            err = (proc.stderr.read() or b"").decode(errors="replace").strip().splitlines()
            return f"API process exited: {err[-1] if err else 'no output'}"
        try:
            if httpx.get(f"{url}/api/health", timeout=3).status_code == 200:
                return None
        except httpx.HTTPError:
            pass
        time.sleep(1)
    return f"no answer from {url}/api/health after {timeout_s:.0f} s"


def check_api(rep: Report, url: str) -> None:
    h = httpx.get(f"{url}/api/health", timeout=10).json()
    alias_of = {sid: a for a, sid in demo_units.load().items() if a in demo_units.ALIASES and isinstance(sid, str)}

    def by_alias(item: str) -> str:                 # "<sid>:aerial" -> "demo-main:aerial"; never print a model id
        sid, _, what = item.partition(":")
        return f"{alias_of.get(sid, 'extra unit')}:{what}" if what else item

    missing = [by_alias(m) for m in (h.get("demo") or {}).get("missing") or []]
    rep.add("api", True, f"/api/health ok: {h.get('cached_models')} cached models"
            + (f"; demo missing {len(missing)} item(s): {', '.join(missing[:3])}" if missing else ""))
    r = httpx.get(f"{url}/api/units", timeout=30)
    rep.add("api", r.status_code == 200, f"/api/units -> {r.status_code}, {r.json().get('total', 0)} units"
            if r.status_code == 200 else f"/api/units -> {r.status_code}")
    sid = (h.get("demo") or {}).get("main_sid")
    if sid:
        r = httpx.get(f"{url}/api/units/{sid}", timeout=120)
        rooms = sum(len(f.get("rooms", [])) for f in r.json().get("floors", [])) if r.status_code == 200 else 0
        rep.add("api", r.status_code == 200 and rooms > 0, f"demo-main plan -> {r.status_code}, {rooms} rooms")
    else:
        rep.add("api", False, "demo-main plan: no main_sid in /api/health")
    r = httpx.get(f"{url}/api/insights", timeout=10)
    rep.add("api", r.status_code == 200, f"/api/insights -> {r.status_code}")


def run_chat(url: str, params: dict, body: dict, timeout_s: float) -> tuple[list[dict], str | None]:
    """Stream one chat run; returns its events and an error (None if it reached `final`)."""
    events: list[dict] = []
    t0 = time.time()
    try:
        with httpx.stream("POST", f"{url}/api/chat", params=params, json=body,
                          timeout=httpx.Timeout(timeout_s, connect=10)) as r:
            if r.status_code != 200:
                r.read()
                return events, f"HTTP {r.status_code}: {r.text[:120]}"
            for line in r.iter_lines():
                if line.startswith("data: "):
                    ev = json.loads(line[6:])
                    events.append(ev)
                    if ev.get("type") == "final":
                        return events, None
                if time.time() - t0 > timeout_s:
                    return events, f"no final event after {timeout_s:.0f} s"
    except httpx.HTTPError as e:
        return events, f"{type(e).__name__}: {str(e)[:120]}"
    return events, "stream ended without a final event"


def check_replay(rep: Report, url: str) -> None:
    t0 = time.time()
    evs, err = run_chat(url, {"replay": 1, "speed": 100}, {}, 60)
    ok = err is None and evs and all(e.get("replay") is True for e in evs)
    rep.add("replay", bool(ok), f"{len(evs)} events to final in {time.time() - t0:.1f} s, all marked replay" if ok
            else (err or "an event was not marked replay"))


def check_live(rep: Report, url: str, skip: bool) -> None:
    from agent.agent import configured
    if skip or not configured():
        rep.add("live", None, "skipped: --no-live" if skip else "skipped: no model key set (MODEL_PROVIDER, MODEL_NAME, key)")
        return
    t0 = time.time()
    evs, err = run_chat(url, {}, {"message": LIVE_MESSAGE, "profile": {"chair_in": [27, 42]}}, 240)
    final = evs[-1] if evs and evs[-1].get("type") == "final" else {}
    shortlist = final.get("shortlist") or []
    paused = any(e.get("type") == "approval_needed" for e in evs)
    ok = err is None and bool(shortlist)
    detail = (f"final in {time.time() - t0:.0f} s, {len(shortlist)} units shortlisted, "
              + ("paused for approval (not approved; nothing sent)" if paused else "no approval step"))
    if err:
        detail = f"{err}" + (" (the live run needs the model provider: is there internet?)"
                             if "Connect" in err or "Timeout" in err or "HTTP 5" in err else "")
    rep.add("live", ok, detail)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="an API that is already running (default: start one on a free port)")
    ap.add_argument("--no-live", action="store_true", help="skip the live agent run")
    a = ap.parse_args(argv)
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    rep = Report()
    check_data(rep)
    proc = None
    url = (a.url or "").rstrip("/")
    if not url:
        port = free_port()
        url = f"http://127.0.0.1:{port}"
        proc = start_api(port)
    try:
        why = wait_up(url, proc)
        if why:
            rep.add("api", False, why)
        else:
            for check in (lambda: check_api(rep, url), lambda: check_replay(rep, url),
                          lambda: check_live(rep, url, a.no_live)):
                try:
                    check()
                except (httpx.HTTPError, ValueError, KeyError) as e:
                    rep.add("error", False, f"{type(e).__name__}: {str(e)[:160]}")
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
    passed = sum(ok is True for _, ok, _ in rep.rows)
    skipped = sum(ok is None for _, ok, _ in rep.rows)
    print(f"{'PASS' if not rep.failed else 'FAIL'}  preflight: {passed} passed, {rep.failed} failed, {skipped} skipped")
    return 1 if rep.failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
