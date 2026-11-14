"""POST /api/chat (SSE stream of agent events) and POST /api/approve.

Events follow contracts/chat_events.example.jsonl: one JSON object per SSE `data:` line, with the
SSE `event:` set to the event type and `id:` to the event id.

    POST /api/chat?replay=1[&pace=1.0 | &speed=N]   stream a recorded run (no model needed); every event has replay: true
    POST /api/chat                       live agent run (503 until a model is configured)
    POST /api/approve {action_id, approved}

Replay source: data/replay/run.jsonl if present (a recorded real run, gitignored), else the synthetic
contract example. `pace` scales the delays (1.0 = realistic, 0 = no delay).
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Callable

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from agent import approvals

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "contracts" / "chat_events.example.jsonl"
# Seconds to wait before each event type in replay: roughly what a live run spends getting there.
DELAY_S = {"plan": 0.8, "tool": 1.6, "finding": 0.9, "verify": 1.2, "aerial": 1.4,
           "approval_needed": 0.8, "final": 0.7}

router = APIRouter()
# Task 3 plugs the live agent in here: a callable (message, profile, run_id) -> async iterator of events.
LiveRunner = Callable[[str, dict, str], AsyncIterator[dict]]
live_runner: LiveRunner | None = None


class ChatRequest(BaseModel):
    message: str = ""
    profile: dict = Field(default_factory=dict)


class ApproveRequest(BaseModel):
    action_id: str
    approved: bool


def data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data")


def replay_source() -> pathlib.Path:
    recorded = data_dir() / "replay" / "run.jsonl"
    return recorded if recorded.exists() else EXAMPLE


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sse(event: dict) -> str:
    return f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"


async def replay_events(pace: float) -> AsyncIterator[dict]:
    lines = replay_source().read_text(encoding="utf-8").splitlines()
    run_id = f"replay_{uuid.uuid4().hex[:8]}"
    for line in lines:
        if not line.strip():
            continue
        ev = json.loads(line)
        if pace > 0:
            await asyncio.sleep(DELAY_S.get(ev["type"], 1.0) * pace)
        ev = {**ev, "recorded_ts": ev.get("ts"), "ts": now(), "run_id": run_id, "replay": True}
        if ev["type"] == "approval_needed":
            ev["action_id"] = f"{ev['action_id']}_{run_id}"
            approvals.register(approvals.Pending(action_id=ev["action_id"], run_id=run_id, action=ev.get("action", ""),
                                                 payload={k: ev.get(k) for k in ("to", "draft")}, replay=True))
        if ev["type"] == "final" and ev.get("awaiting_approval"):
            ev["awaiting_approval"] = [f"{a}_{run_id}" for a in ev["awaiting_approval"]]
        yield ev


async def stream(events: AsyncIterator[dict]) -> AsyncIterator[str]:
    yield ": rollin event stream\n\n"
    async for ev in events:
        yield sse(ev)


@router.post("/api/chat")
async def chat(req: ChatRequest | None = None, replay: bool = False, pace: float = Query(1.0, ge=0, le=10),
               speed: float | None = Query(None, gt=0, le=100)):
    req = req or ChatRequest()                      # replay needs no body
    if speed is not None:                           # ?speed=4 plays 4x faster; events stay marked replay
        pace = 1.0 / speed
    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    if replay:
        return StreamingResponse(stream(replay_events(pace)), media_type="text/event-stream", headers=headers)
    if live_runner is None:
        return JSONResponse({"detail": "live agent not configured (set MODEL_PROVIDER, MODEL_NAME and a model key); "
                                       "use ?replay=1"}, status_code=503)
    if not req.message.strip():
        raise HTTPException(422, "message is required")
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    return StreamingResponse(stream(live_runner(req.message, req.profile, run_id)),
                             media_type="text/event-stream", headers=headers)


@router.post("/api/approve")
def approve(req: ApproveRequest) -> dict:
    try:
        return approvals.resolve(req.action_id, req.approved)
    except approvals.UnknownAction:
        raise HTTPException(404, f"unknown action_id {req.action_id}")
    except approvals.AlreadyResolved:
        raise HTTPException(409, f"{req.action_id} was already decided")
    except approvals.ActionFailed as e:
        raise HTTPException(502, f"{e}; nothing was recorded, you can approve again")
