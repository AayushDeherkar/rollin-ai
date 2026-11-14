"""Rollin' orchestrator (deepagents 0.7.38, PLAN 7.1).

    python -m agent.agent "27x42 in power chair, 1-2 bedrooms near the Texas Medical Center"   # one live run

Model: MODEL_PROVIDER (google | anthropic) + MODEL_NAME from .env. LangSmith tracing follows LANGSMITH_* in .env.
Tools read only local data (data/cache, data/batch). `send_message` is the only outbound tool: it is held by
the orchestrator alone (no subagent has it), it is in `interrupt_on`, and it runs only after POST /api/approve
resumes the graph. Even then it only queues the message in data/outbox/ for the messaging bridge.
Events streamed to the UI follow contracts/chat_events.example.jsonl. Findings come from engine output, never
from model text.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(os.environ.get("ROLLIN_ENV_FILE") or ROOT / ".env")     # ROLLIN_ENV_FILE: use another checkout's .env

from agent import approvals  # noqa: E402
from agent.chat import data_dir  # noqa: E402
from engine.fit import analyze_model  # noqa: E402

PROVIDERS = {"google": "google_genai", "anthropic": "anthropic"}
KEYS = {"google": "GOOGLE_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
AI_DISCLOSURE = "Hi, this is an AI assistant (Rollin') writing on behalf of a client. "
TMC = (29.7095, -95.3982)


# ---------------------------------------------------------------- tools (local data only)

def _index() -> dict:
    path = data_dir() / "batch" / "index.json"
    return json.loads(path.read_text()) if path.exists() else {"units": []}


def _beds(name: str | None) -> int | None:
    from agent.server import beds_of
    return beds_of(name)


def search_units(radius_km: float = 8.0, beds: int | None = None, top: int = 5,
                 rank_with_hinges: bool = False) -> dict:
    """Ranked apartment units near the Texas Medical Center from the precomputed batch (27x42 in chair).

    Args:
        radius_km: max distance from the Texas Medical Center.
        beds: exact number of bedrooms (0 = studio), or None for any.
        top: how many units to return.
        rank_with_hinges: rank by the scores the units would have with offset hinges on every door.
    """
    idx = _index()
    rows = [u for u in idx.get("units", []) if (u.get("distance_km") or 99) <= radius_km
            and (beds is None or _beds(u.get("name")) == beds)]
    key = (lambda u: (-u["with_hinges"]["score"], u["counts"]["blocked"])) if rank_with_hinges else \
          (lambda u: (-u["score"], u["counts"]["blocked"]))
    rows.sort(key=key)
    return {"chair_in": idx.get("chair_in"), "candidates": len(rows),
            "units": [{k: u.get(k) for k in ("sid", "name", "distance_km", "score", "counts", "with_hinges", "summary")}
                      for u in rows[:max(1, min(top, 20))]]}


def get_unit(sid: str) -> dict:
    """Name, distance and room counts for one unit from the batch index."""
    for u in _index().get("units", []):
        if u["sid"] == sid:
            return {k: u.get(k) for k in ("sid", "name", "distance_km", "score", "counts", "with_hinges", "summary")}
    return {"sid": sid, "error": "not in the ranked batch index"}


def run_fit(sid: str, chair_width_in: float = 27.0, chair_length_in: float = 42.0, hinges: bool = False) -> dict:
    """Drive a wheelchair through a unit's measured floor plan. Returns each room's status
    (reachable / blocked / unknown), the reason, its doors (measured width, estimated clear width) and
    the door that stops the chair. Set hinges=True to simulate offset hinges on every door."""
    path = data_dir() / "cache" / f"{sid}.json"
    if not path.exists():
        return {"sid": sid, "error": "model not cached"}
    res = analyze_model(json.loads(path.read_text())["data"]["model"], sid, chair_width_in, chair_length_in, hinges)
    rooms = []
    for f in res["floors"]:
        doors = {d["edge"]: d for d in f.get("doors", [])}
        for r in f["rooms"]:
            stop = doors.get(r.get("blocking_door_edge") or "")
            rooms.append({"room_id": r["room_id"], "label": r["label"], "status": r["status"], "reason": r["reason"],
                          "door_widths_in": [d["width_in"] for d in r["doors"]],
                          "blocking_door": {"edge": stop["edge"], "width_in": stop["width_in"],
                                            "clear_in_est": stop["clear_in_est"]} if stop else None,
                          "turning_circle_in": (r["turning_space"] or {}).get("max_circle_in")})
    return {"sid": sid, "name": res["name"], "scenario": res["scenario"], "chair_in": res["chair_in"], "rooms": rooms}


def with_ai_disclosure(text: str) -> str:
    """Every outbound message says up front that it comes from an AI."""
    return text if "AI assistant" in text[:200] else AI_DISCLOSURE + text


def draft_landlord_message(sid: str, questions: list[str], chair_width_in: float = 27.0) -> dict:
    """Draft (do not send) a short message to a unit's leasing office asking only what the scan cannot answer."""
    name = get_unit(sid).get("name") or sid
    lines = [with_ai_disclosure(f"My client uses a {chair_width_in:g}-inch-wide power wheelchair and is interested "
                                f"in your {name} floor plan."), "Could you help with a few questions?"]
    lines += [f"{i}. {q}" for i, q in enumerate(questions, 1)]
    lines.append("Thank you!")
    return {"sid": sid, "to": f"Leasing office ({name})", "text": "\n".join(lines)}


def send_message(to: str, text: str) -> dict:
    """Send a message to a leasing office. A human must approve it first; the run pauses until they do."""
    box = data_dir() / "outbox"
    box.mkdir(parents=True, exist_ok=True)
    rec = {"to": to, "text": with_ai_disclosure(text), "queued_at": datetime.now(timezone.utc).isoformat()}
    path = box / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{uuid.uuid4().hex[:6]}.json"
    path.write_text(json.dumps(rec, indent=1))
    return {"status": "queued in outbox for the messaging bridge (not delivered by the agent)", "to": to}


# ---------------------------------------------------------------- agent definition

SYSTEM = """You are Rollin', an AI assistant for hospital case managers finding apartments a wheelchair user can live in.
Your first action is write_todos with the plan. Then delegate:
1. `search` subagent: find candidate units (Houston, near the Texas Medical Center) that match the request.
2. `geometry` subagent: run the fit engine on the top 2-3 candidates, as scanned and with offset hinges when a door is
   short by 1.75 in or less; report each blocked or unknown bedroom/bathroom with its measured door width.
3. `verifier` subagent: label every claim measured / estimated / assumed / unknown and turn unknowns into questions.
4. `outreach` subagent: draft ONE message to the leasing office of the best unit with those questions.
Then call send_message with that drafted text and recipient. A human must approve it; you cannot send without approval.
Finish with a short shortlist: each unit's sid, name, rooms reachable as scanned and with hinges, and what is unknown.
Always use the user's exact chair size; never try other sizes. You do not need the file tools.
Rules: use only tool results; never invent door widths, statistics or units. Unknown stays unknown. Say clear widths
and turning circles are estimates. Be brief."""


def subagents(model: Any) -> list[dict]:
    return [
        {"name": "search", "description": "Finds candidate apartment units from the ranked batch by area and bedrooms.",
         "system_prompt": "Call search_units at most twice (e.g. once per bedroom count), then return the best 3-5 sids with "
                          "names, distance and room counts. Include any unit the user named. Never invent units.",
         "tools": [search_units, get_unit], "model": model},
        {"name": "geometry", "description": "Runs the wheelchair fit engine on units and explains every blocked room.",
         "system_prompt": "Use run_fit with the user's exact chair size only (as scanned, then hinges=True where a door is short "
                          "by <=1.75 in). For each blocked or "
                          "unknown room give the measured door width, estimated clear width and shortfall from the tool output only.",
         "tools": [run_fit, get_unit], "model": model},
        {"name": "verifier", "description": "Checks claims against engine output and labels each one's basis.",
         "system_prompt": "Re-check each claim with run_fit using the user's exact chair size. Label it measured (door widths, walls), estimated (clear width, "
                          "turning circle), assumed (hinge gain ~1.75 in) or unknown. List unknowns as questions for the landlord.",
         "tools": [run_fit, get_unit], "model": model},
        {"name": "outreach", "description": "Drafts (never sends) a message to a leasing office.",
         "system_prompt": "Call draft_landlord_message once with the questions you are given. Return the draft text and recipient. "
                          "You cannot send messages.",
         "tools": [draft_landlord_message], "model": model},
    ]


INTERRUPT_ON = {"send_message": {"allowed_decisions": ["approve", "reject"]}}
ORCHESTRATOR_TOOLS = [search_units, get_unit, run_fit, draft_landlord_message, send_message]


def configured() -> bool:
    prov = os.environ.get("MODEL_PROVIDER", "").lower()
    return prov in PROVIDERS and bool(os.environ.get("MODEL_NAME")) and bool(os.environ.get(KEYS[prov]))


_agent = None


def get_agent():
    global _agent
    if _agent is None:
        from deepagents import create_deep_agent
        from langchain.chat_models import init_chat_model
        from langgraph.checkpoint.memory import InMemorySaver
        model = init_chat_model(os.environ["MODEL_NAME"], model_provider=PROVIDERS[os.environ["MODEL_PROVIDER"].lower()])
        _agent = create_deep_agent(model=model, tools=ORCHESTRATOR_TOOLS, system_prompt=SYSTEM,
                                   subagents=subagents(model), interrupt_on=INTERRUPT_ON,
                                   checkpointer=InMemorySaver(), name="rollin")
    return _agent


# ---------------------------------------------------------------- events (contract: chat_events.example.jsonl)

def num(value: Any, basis: str, unit: str | None = None, **extra) -> dict:
    d = {"value": value, "basis": basis, **({"unit": unit} if unit else {}), **extra}
    return d


ASKED = {"chair_width_in", "chair_length_in", "radius_km", "beds"}
FS_TOOLS = {"ls", "glob", "grep", "read_file", "write_file", "edit_file"}      # deepagents scratch files: not shown


def wrap_args(args: dict) -> dict:
    """Tool arguments as contract values: user-given sizes are `asked`, the agent's own choices `assumed`."""
    out = {}
    for k, v in args.items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            out[k] = v
        else:
            out[k] = num(v, "asked" if k in ASKED else "assumed", "in" if k.endswith("_in") else
                         "km" if k.endswith("_km") else None, **({"source": "user"} if k in ASKED else {}))
    return out


def text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "".join(p.get("text", "") for p in content if isinstance(p, dict)) if isinstance(content, list) else ""


def counts_of(rooms: list[dict]) -> dict:
    c = {"reachable": 0, "blocked": 0, "unknown": 0}
    for r in rooms:
        c[r["status"]] += 1
    return {k: num(v, "estimated") for k, v in c.items()}


def findings_from_fit(res: dict, chair_w: float) -> list[dict]:
    """One finding per blocked/unknown room, numbers straight from the engine."""
    out = []
    for r in res.get("rooms", []):
        if r["status"] == "reachable":
            continue
        stop = r.get("blocking_door")
        numbers = {"door_widths": [num(w, "measured", "in") for w in r["door_widths_in"]]}
        if stop:
            numbers.update(blocking_door_width=num(stop["width_in"], "measured", "in"),
                           clear_width=num(stop["clear_in_est"], "estimated", "in"),
                           shortfall=num(round(chair_w - stop["clear_in_est"], 1), "estimated", "in"))
        if r.get("turning_circle_in") is not None:
            numbers["turning_circle"] = num(r["turning_circle_in"], "estimated", "in", note="walls only")
        if r["status"] == "unknown":
            numbers["door_width"] = num(None, "unknown", "in")
        out.append({"type": "finding", "sid": res["sid"], "room_id": r["room_id"], "room": r["label"],
                    "status": r["status"], "scenario": res["scenario"], "text": r["reason"], "numbers": numbers,
                    "evidence": {"kind": "door", "edge": stop["edge"]} if stop else {"kind": "room"}})
    return out


PIPELINE = ["Find candidate units near the Texas Medical Center (search)",
            "Drive the chair through each candidate's floor plan, as scanned and with offset hinges (geometry)",
            "Check every claim and label its basis; turn unknowns into questions (verifier)",
            "Draft questions for the leasing office (outreach)",
            "Ask for approval before sending anything"]


class Run:
    """Turns one agent stream into contract events."""

    def __init__(self, run_id: str):
        self.run_id, self.n, self.seen_findings = run_id, 0, set()
        self.last_search: dict | None = None
        self.pending: list[str] = []
        self.calls: dict[str, tuple[str, dict]] = {}
        self.fits: dict[tuple[str, str], dict] = {}          # (sid, scenario) -> raw room counts from run_fit

    def ev(self, type_: str, **body) -> dict:
        self.n += 1
        return {"id": f"evt_{self.n:03d}", "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"), "run_id": self.run_id, "type": type_, **body}

    def from_ai(self, m: Any, ns: tuple) -> list[dict]:
        out = []
        for tc in getattr(m, "tool_calls", None) or []:
            self.calls[tc.get("id") or ""] = (tc["name"], tc["args"])
            if tc["name"] == "write_todos":
                todos = [{"id": f"t{i}", "text": t.get("content", ""), "status": t.get("status", "pending")}
                         for i, t in enumerate(tc["args"].get("todos", []), 1)]
                out.append(self.ev("plan", text="Agent plan", source="model", todos=todos))
            elif tc["name"] == "task":
                out.append(self.ev("tool", name="task", subagent=tc["args"].get("subagent_type"), status="called",
                                   args={"description": tc["args"].get("description", "")}))
            elif tc["name"] not in FS_TOOLS and tc["name"] != "send_message":
                out.append(self.ev("tool", name=tc["name"], status="called", agent=ns[-1].split(":")[0] if ns else "rollin",
                                   args=wrap_args(tc["args"])))
        return out

    def from_tool(self, m: Any) -> list[dict]:
        name, args = self.calls.get(getattr(m, "tool_call_id", "") or "", (getattr(m, "name", ""), {}))
        try:
            data = json.loads(text_of(m.content))
        except (ValueError, TypeError):
            data = None
        if name == "run_fit" and isinstance(data, dict) and "rooms" in data:
            raw = {s: sum(1 for r in data["rooms"] if r["status"] == s) for s in ("reachable", "blocked", "unknown")}
            self.fits[(data["sid"], data["scenario"])] = {"name": data["name"], "counts": raw}
            out = [self.ev("tool", name="run_fit", status="done", args=wrap_args(args),
                           result={"sid": data["sid"], "scenario": data["scenario"], "counts": counts_of(data["rooms"])})]
            for f in findings_from_fit(data, float(data["chair_in"][0])):
                key = (f["sid"], f["room_id"], f["scenario"])
                if key not in self.seen_findings:
                    self.seen_findings.add(key)
                    out.append(self.ev(f.pop("type"), **f))
            return out
        if name == "search_units" and isinstance(data, dict):
            self.last_search = data
            return [self.ev("tool", name="search_units", status="done", args=wrap_args(args),
                            result={"candidates": num(data["candidates"], "measured"),
                                    "sids": [u["sid"] for u in data["units"]]})]
        if name == "task":
            sub = args.get("subagent_type")
            text = text_of(m.content)
            if sub == "verifier":
                return [self.ev("verify", text=text)]
            return [self.ev("tool", name="task", subagent=sub, status="done", result={"text": text})]
        if name in ("get_unit", "draft_landlord_message"):
            return [self.ev("tool", name=name, status="done", args=wrap_args(args),
                            result=data if name == "draft_landlord_message" else {"sid": args.get("sid")})]
        return []

    def from_interrupt(self, interrupt: Any, thread: dict) -> list[dict]:
        out = []
        for i, req in enumerate(interrupt.value.get("action_requests", [])):
            if req.get("name") != "send_message":
                continue
            action_id = f"act_{self.run_id}_{len(self.pending) + 1}"
            text = with_ai_disclosure(req["args"].get("text", ""))
            approvals.register(approvals.Pending(action_id=action_id, run_id=self.run_id, action="send_message",
                                                 payload={"to": req["args"].get("to"), "text": text},
                                                 on_resolve=lambda approved, t=thread: resume(t, approved)))
            self.pending.append(action_id)
            out.append(self.ev("approval_needed", action_id=action_id, action="send_message",
                               to={"label": req["args"].get("to")}, draft=text,
                               reason="Outbound messages always need a person's approval."))
        return out

    def shortlist(self) -> list[dict]:
        """Units the fit engine actually checked this run, best first (as scanned)."""
        scanned = {sid: v for (sid, sc), v in self.fits.items() if sc == "as scanned"}
        def frac(c):
            t = sum(c.values())
            return c["reachable"] / t if t else 0.0
        order = sorted(scanned, key=lambda s: (-frac(scanned[s]["counts"]), scanned[s]["counts"]["blocked"], s))
        out = []
        for i, sid in enumerate(order[:3], 1):
            c = scanned[sid]["counts"]
            h = self.fits.get((sid, "offset hinges on every door"))
            out.append({"sid": sid, "name": scanned[sid]["name"], "rank": num(i, "estimated"),
                        "score": num(round(frac(c), 3), "estimated"),
                        "counts": {k: num(v, "estimated") for k, v in c.items()},
                        "with_hinges": {k: num(v, "estimated") for k, v in h["counts"].items()} if h else None,
                        "summary": f"{c['reachable']} of {sum(c.values())} rooms reachable as scanned"
                                   + (f"; {h['counts']['reachable']} with offset hinges" if h else "")})
        return out

    def final(self, agent_text: str) -> dict:
        sl = self.shortlist()
        parts = [f"Checked {len({s for s, _ in self.fits})} units with the fit engine."] if self.fits else []
        if sl:
            parts.append(f"Best: {sl[0]['name']} ({sl[0]['sid']}), {sl[0]['summary']}.")
        if self.pending:
            parts.append("Waiting for your approval before contacting the leasing office.")
        if agent_text and not self.pending:
            parts.append(agent_text)
        return self.ev("final", text=" ".join(parts) or agent_text, awaiting_approval=list(self.pending), shortlist=sl)


def resume(thread: dict, approved: bool) -> dict:
    """Called by POST /api/approve: continue the paused graph with the person's decision."""
    from langgraph.types import Command
    decision = {"type": "approve"} if approved else {"type": "reject", "message": "The case manager declined."}
    out = get_agent().invoke(Command(resume={"decisions": [decision]}), thread)
    sent = [m for m in out["messages"] if getattr(m, "name", "") == "send_message"]
    return {"status": (json.loads(text_of(sent[-1].content)).get("status") if sent and approved else
                       "declined: nothing sent"), "final_text": text_of(out["messages"][-1].content)}


async def run_agent(message: str, profile: dict, run_id: str) -> AsyncIterator[dict]:
    """Live runner for POST /api/chat."""
    agent = get_agent()
    thread = {"configurable": {"thread_id": run_id}, "recursion_limit": 120,
              "metadata": {"run_id": run_id}, "run_name": "rollin-chat"}
    prompt = message if not profile else f"{message}\n\nProfile: {json.dumps(profile)}"
    r = Run(run_id)
    yield r.ev("plan", text="Orchestrator pipeline", source="orchestrator",
               todos=[{"id": f"t{i}", "text": t, "status": "pending"} for i, t in enumerate(PIPELINE, 1)])
    async for ns, chunk in agent.astream({"messages": [{"role": "user", "content": prompt}]}, thread,
                                         stream_mode="updates", subgraphs=True):
        for node, upd in chunk.items():
            if node == "__interrupt__":
                for it in upd:
                    for e in r.from_interrupt(it, thread):
                        yield e
                continue
            for m in (upd or {}).get("messages", []) if isinstance(upd, dict) else []:
                kind = type(m).__name__
                for e in (r.from_ai(m, ns) if kind == "AIMessage" else r.from_tool(m) if kind == "ToolMessage" else []):
                    yield e
    state = await agent.aget_state(thread)
    msgs = state.values.get("messages", [])
    last = next((text_of(m.content) for m in reversed(msgs) if type(m).__name__ == "AIMessage" and text_of(m.content)), "")
    yield r.final(last)


def main(argv: list[str]) -> int:
    msg = " ".join(argv) or "Power chair 27 x 42 inches; needs to reach a bedroom and a bathroom; 1 or 2 bedrooms near the Texas Medical Center."

    async def go():
        async for e in run_agent(msg, {}, f"run_{uuid.uuid4().hex[:8]}"):
            print(json.dumps(e))
    asyncio.run(go())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
