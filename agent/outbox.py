"""Delivery of approved messages and leasing-office answers (PLAN 7.2, round 5).

    GET  /api/outbox                    approved messages waiting for the messaging bridge
    POST /api/outbox/{id}/delivered     the bridge delivered one: mark it sent
    POST /api/answers                   a leasing-office reply: log it; matching unknown rooms become basis "asked"
    GET  /api/events                    SSE stream of `delivered` and `answer` events, so the UI updates after a run

Files (all under the gitignored data dir): outbox/<id>.json (queued by agent.send_message after approval) and
answers/<id>.json (one per reply). Answers are applied on top of engine output by `apply_answers`; the engine's
own verdict (`status`) never changes, since an answer about one door does not prove the chair can reach it.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.chat import data_dir, now, sse

router = APIRouter()
OUTBOX_ID = re.compile(r"^\d{8}T\d{6}_[0-9a-f]{6}$")
INCH = r"(?:\"|”|''|inch(?:es)?\b|in\b\.?(?!\s+(?:the|a|an|our|this|that|unit|building)\b))"
FT_IN = re.compile(r"\b(\d)\s*(?:'|’|ft\.?|feet|foot)\s*-?\s*(\d{1,2}(?:\.\d+)?)\s*" + INCH + "?", re.I)
INCHES = re.compile(r"(?<![\d'’.])(\d{2}(?:\.\d+)?)\s*-?\s*" + INCH, re.I)
NOT_WIDTH = re.compile(r"^[\s-]*(?:tall|high|height|long|length|deep|depth)\b", re.I)
WIDTH_IN = (18.0, 60.0)                         # plausible door clear widths; anything else is not taken as one
NUMBERED = re.compile(r"^\s*(\d{1,2})[.)]\s*(.+)$")
_lock = threading.Lock()


# ---------------------------------------------------------------- event hub

class Hub:
    """Fan-out of non-run events (`delivered`, `answer`) to every open GET /api/events stream.
    Keeps the last 100 so a client reconnecting with Last-Event-ID misses nothing."""

    def __init__(self) -> None:
        self.recent: deque[dict] = deque(maxlen=100)
        self.subs: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
        self.lock = threading.Lock()

    def publish(self, type_: str, run_id: str | None = None, **fields) -> dict:
        ev = {"id": f"evt_{uuid.uuid4().hex[:10]}", "ts": now(), "run_id": run_id, "type": type_, **fields}
        with self.lock:
            self.recent.append(ev)
            subs = list(self.subs)
        for loop, q in subs:                        # POST handlers run in a worker thread
            try:
                loop.call_soon_threadsafe(q.put_nowait, ev)
            except RuntimeError:                    # that client's loop is gone
                pass
        return ev

    def since(self, last_id: str | None) -> list[dict]:
        with self.lock:
            evs = list(self.recent)
        ids = [e["id"] for e in evs]
        return evs[ids.index(last_id) + 1:] if last_id in ids else []

    async def stream(self, last_id: str | None) -> AsyncIterator[str]:
        sub = (asyncio.get_running_loop(), asyncio.Queue())
        with self.lock:
            self.subs.add(sub)
        try:
            yield ": rollin events\n\n"
            replayed = set()
            for ev in self.since(last_id):
                replayed.add(ev["id"])
                yield sse(ev)
            while True:
                try:
                    ev = await asyncio.wait_for(sub[1].get(), timeout=15)
                    if ev["id"] not in replayed:    # published during the replay: already sent
                        yield sse(ev)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            with self.lock:
                self.subs.discard(sub)


hub = Hub()


# ---------------------------------------------------------------- outbox

def _box():
    return data_dir() / "outbox"


def _read(path) -> dict | None:
    try:
        rec = json.loads(path.read_text(encoding="utf-8"))
        return rec if isinstance(rec, dict) else None
    except (OSError, ValueError):
        return None


def item(path, rec: dict) -> dict:
    return {"id": path.stem, "to": rec.get("to"), "text": rec.get("text"), "sid": rec.get("sid"),
            "questions": rec.get("questions") or [], "queued_at": rec.get("queued_at"),
            "status": rec.get("status") or "pending", "delivered_at": rec.get("delivered_at"),
            "via": rec.get("via")}


def pending() -> list[dict]:
    """Approved, queued messages not yet delivered, oldest first."""
    box = _box()
    rows = []
    for p in sorted(box.glob("*.json")) if box.exists() else []:
        rec = _read(p)
        if rec is not None and OUTBOX_ID.match(p.stem) and (rec.get("status") or "pending") == "pending":
            rows.append(item(p, rec))
    return rows


def mark_delivered(outbox_id: str, via: str, detail: str | None = None) -> dict:
    if not OUTBOX_ID.match(outbox_id):
        raise HTTPException(400, "bad outbox id")
    path = _box() / f"{outbox_id}.json"
    with _lock:
        rec = _read(path) if path.exists() else None
        if rec is None:
            raise HTTPException(404, f"no queued message {outbox_id}")
        if rec.get("status") == "delivered":
            raise HTTPException(409, f"{outbox_id} was already marked delivered")
        rec.update(status="delivered", delivered_at=now(), via=via, **({"detail": detail} if detail else {}))
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(rec, indent=1), encoding="utf-8")
        tmp.replace(path)
    out = item(path, rec)
    hub.publish("delivered", rec.get("run_id"), outbox_id=outbox_id, sid=out["sid"], to=out["to"], via=via,
                delivered_at=out["delivered_at"], text=f"Delivered to {out['to']} via {via}.")
    return out


# ---------------------------------------------------------------- answers

def plausible(v) -> float | None:
    """A finite number in the door-width range, else None (NaN, heights, unit numbers)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v) if WIDTH_IN[0] <= v <= WIDTH_IN[1] else None


def _inches(text: str) -> float | None:
    """The one door width a line states in inches (2'10" = 34). Heights ("80 in tall") are skipped. If a line
    states two different widths (frame and clear, say) we cannot tell which is meant, so it stays unknown."""
    vals, spans = set(), []
    for m in FT_IN.finditer(text):
        spans.append(m.span())
        if not NOT_WIDTH.match(text[m.end():]):
            vals.add(plausible(int(m.group(1)) * 12 + float(m.group(2))))
    for m in INCHES.finditer(text):
        if any(a <= m.start() < b for a, b in spans) or NOT_WIDTH.match(text[m.end():]):
            continue
        vals.add(plausible(float(m.group(1))))
    vals.discard(None)
    return vals.pop() if len(vals) == 1 else None


def match_answers(rooms: list[dict], text: str, answers: list[dict], questions: list[str]) -> tuple[list[dict], list[str]]:
    """Which unknown rooms a reply answers, as [{room_id, label, clear_in, said}], plus the lines nothing matched.

    `answers` (structured, from the bridge) win: each {room, clear_width_in?, answer?} names a room label or id.
    Otherwise the free text is read conservatively: a numbered line answers the outbox question with that number,
    and a line naming an unknown room's label answers that room. A width is taken only when written in inches."""
    unknown = [r for r in rooms if r.get("status") == "unknown"]
    by_key: dict[str, list[dict]] = {}
    for r in unknown:
        for k in (r.get("room_id"), r.get("label")):
            if k:
                by_key.setdefault(str(k).lower(), []).append(r)
    hits: dict[str, dict] = {}

    def hit(rs: list[dict], clear_in: float | None, said: str) -> None:
        for r in rs:
            hits.setdefault(r["room_id"], {"room_id": r["room_id"], "label": r["label"], "clear_in": clear_in,
                                           "said": said.strip()})

    unmatched: list[str] = []
    for a in answers:
        rs = by_key.get(str(a.get("room", "")).lower())
        if rs:
            hit(rs, plausible(a.get("clear_width_in")), str(a.get("answer") or ""))
        else:
            unmatched.append(str(a.get("room", "")))
    if not answers:
        for line in (ln for ln in text.splitlines() if ln.strip()):
            m = NUMBERED.match(line)
            target = None
            if m and 1 <= int(m.group(1)) <= len(questions):    # it answers that question, or no room at all
                q = (questions[int(m.group(1)) - 1] or "").lower()
                target = next((by_key[k] for k in sorted(by_key, key=len, reverse=True) if f"the {k} door" in q), None)
            else:
                low = line.lower()
                target = next((by_key[k] for k in sorted(by_key, key=len, reverse=True)
                               if re.search(rf"\b{re.escape(k)}\b", low)), None)
            if target:
                hit(target, _inches(line), m.group(2) if m else line)
            else:
                unmatched.append(line.strip())
    return list(hits.values()), unmatched


def _answers_dir():
    return data_dir() / "answers"


def answers_for(sid: str) -> list[dict]:
    """Every logged answer for a unit, oldest first."""
    d = _answers_dir()
    out = []
    for p in sorted(d.glob("*.json")) if d.exists() else []:
        rec = _read(p)
        if rec is not None and rec.get("sid") == sid:
            out.append(rec)
    return out


def apply_answers(result: dict, sid: str) -> dict:
    """Engine output with every answered unknown room marked basis "asked" (source landlord). Status is unchanged."""
    latest: dict[str, dict] = {}
    for rec in answers_for(sid):
        for r in rec.get("rooms", []):
            latest[r["room_id"]] = {**r, "answer_id": rec["id"], "answered_at": rec.get("received_at")}
    if not latest:
        return result
    out = json.loads(json.dumps(result))
    for floor in out.get("floors", []):
        for room in floor.get("rooms", []):
            a = latest.get(room.get("room_id"))
            if a:
                a = {**a, "clear_in": plausible(a.get("clear_in"))}     # files written before validation
            if a and room.get("status") == "unknown":
                room["basis"] = "asked"
                room["answer"] = {"clear_in": ({"value": a["clear_in"], "unit": "in", "basis": "asked", "source": "landlord"}
                                               if a.get("clear_in") is not None else {"value": None, "basis": "unknown"}),
                                  "said": a.get("said", ""), "answer_id": a["answer_id"], "answered_at": a["answered_at"]}
    return out


def log_answer(sid: str, rooms_now: list[dict], text: str, answers: list[dict], outbox_id: str | None,
               questions: list[str], sender: str | None, run_id: str | None = None) -> dict:
    rooms, unmatched = match_answers(rooms_now, text, answers, questions)
    rec = {"id": f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{uuid.uuid4().hex[:6]}", "sid": sid,
           "outbox_id": outbox_id, "from": sender, "text": text, "answers": answers, "rooms": rooms,
           "unmatched": unmatched, "received_at": now()}
    d = _answers_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{rec['id']}.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
    labels = ", ".join(r["label"] for r in rooms)
    hub.publish("answer", run_id, answer_id=rec["id"], sid=sid, outbox_id=outbox_id,
                rooms=[{"room_id": r["room_id"], "label": r["label"], "basis": "asked", "source": "landlord",
                        "clear_in": ({"value": r["clear_in"], "unit": "in", "basis": "asked", "source": "landlord"}
                                     if r["clear_in"] is not None else {"value": None, "basis": "unknown"})}
                       for r in rooms],
                unmatched=unmatched,
                text=(f"Leasing office answered for {labels}." if rooms else
                      "Leasing office replied; no unknown room matched, so nothing changed."))
    return rec


# ---------------------------------------------------------------- routes

class Delivered(BaseModel):
    via: str = "imessage"
    detail: str | None = None


@router.get("/api/outbox")
def get_outbox() -> dict:
    rows = pending()
    return {"total": len(rows), "items": rows}


@router.post("/api/outbox/{outbox_id}/delivered")
def post_delivered(outbox_id: str, body: Delivered | None = None) -> dict:
    body = body or Delivered()
    return mark_delivered(outbox_id, body.via, body.detail)


@router.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    return StreamingResponse(hub.stream(request.headers.get("last-event-id")), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
