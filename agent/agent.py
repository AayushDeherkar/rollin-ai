"""Rollin' orchestrator (deepagents 0.7.38, PLAN 7.1).

    python -m agent.agent "27x42 in power chair, 1-2 bedrooms near the Texas Medical Center"   # one live run

Model: MODEL_PROVIDER (google | anthropic) + MODEL_NAME from .env. LangSmith tracing follows LANGSMITH_* in .env.
Tools read only local data (data/cache, data/batch). `send_message` is the only outbound tool: it is held by
the orchestrator alone (no subagent has it; we supply our own read-only `general-purpose` subagent so deepagents
does not add its default one with the main tools), it is in `interrupt_on`, and it runs only after POST /api/approve
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


def _row(u: dict) -> dict:
    c, h = u["counts"], u["with_hinges"]["counts"]
    total = sum(c.values())
    return {"sid": u["sid"], "name": u.get("name"), "km": u.get("distance_km"),
            "reachable": f"{c['reachable']}/{total}", "with_hinges": f"{h['reachable']}/{total}"}


def search_units(radius_km: float = 8.0, beds: list[int] | int | None = None, top: int = 3,
                 include: list[str] | None = None) -> dict:
    """Best units near the Texas Medical Center from the precomputed batch (27x42 in chair), compact.

    Args:
        radius_km: max distance from the Texas Medical Center.
        beds: acceptable bedroom counts (0 = studio), or None for any.
        top: how many units to return (max 5).
        include: unit ids the person named; always returned, even outside the radius.
    """
    idx = _index()
    units = idx.get("units", [])
    if isinstance(beds, int):                    # the model sometimes passes a single count
        beds = [beds]
    rows = [u for u in units if (u.get("distance_km") or 99) <= radius_km
            and (not beds or _beds(u.get("name")) in beds)]
    rows.sort(key=lambda u: (-u["score"], u["counts"]["blocked"], u.get("distance_km") or 99))
    picked = rows[:max(1, min(top, 5))]
    named = [u for u in units if u["sid"] in (include or []) and u not in picked]
    return {"candidates": len(rows), "units": [_row(u) for u in picked + named]}


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
    fit_cache = data_dir() / "cache" / "fit" / f"{sid}_{chair_width_in:g}x{chair_length_in:g}_{int(hinges)}_v{FIT_CACHE_V}.json"
    key = _fit_key(path)
    if fit_cache.exists():
        try:                                                     # valid only for this exact model file and engine code
            cached = json.loads(fit_cache.read_text())
            if isinstance(cached, dict) and cached.get("_key") == key:
                return {k: v for k, v in cached.items() if k != "_key"}
        except (ValueError, OSError):                            # unreadable: recompute and overwrite
            pass
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
    out = {"sid": sid, "name": res["name"], "scenario": res["scenario"], "chair_in": res["chair_in"], "rooms": rooms}
    fit_cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = fit_cache.with_suffix(f".{uuid.uuid4().hex[:6]}.tmp")    # atomic: parallel subagents may write the same key
    tmp.write_text(json.dumps({**out, "_key": key}))
    os.replace(tmp, fit_cache)
    return out


MAX_CHECK = 6
FIT_CACHE_V = 1                      # bump when run_fit's output shape changes


_ENGINE_SHA: str | None = None


def _fit_key(model_path: pathlib.Path) -> str:
    """Content key for a cached fit: model file + engine source. Survives copies, unzips and clock differences."""
    import hashlib
    global _ENGINE_SHA
    if _ENGINE_SHA is None:
        _ENGINE_SHA = hashlib.sha1((ROOT / "engine" / "fit.py").read_bytes()).hexdigest()[:12]
    return hashlib.sha1(model_path.read_bytes()).hexdigest()[:12] + "-" + _ENGINE_SHA


def check_units(sids: list[str], chair_width_in: float = 27.0, chair_length_in: float = 42.0) -> dict:
    """Drive the wheelchair through up to 6 units at once, as scanned and with offset hinges. Returns, per unit,
    rooms reachable in each scenario and only the rooms that are blocked or unknown (with the measured width of
    the door that stops the chair and the estimated shortfall)."""
    out = []
    for sid in sids[:MAX_CHECK]:
        a, h = run_fit(sid, chair_width_in, chair_length_in), run_fit(sid, chair_width_in, chair_length_in, True)
        if "error" in a:
            out.append({"sid": sid, "error": a["error"]})
            continue
        hs = {r["room_id"]: r["status"] for r in h["rooms"]}
        problems = []
        for r in a["rooms"]:
            if r["status"] == "reachable":
                continue
            stop = r.get("blocking_door")
            p = {"room": r["label"], "status": r["status"], "with_hinges": hs.get(r["room_id"])}
            if stop:
                p["door_in"] = stop["width_in"]
                if stop["clear_in_est"] < chair_width_in:
                    p["short_in_est"] = round(chair_width_in - stop["clear_in_est"], 1)
            problems.append(p)
        n = len(a["rooms"])
        out.append({"sid": sid, "name": a["name"],
                    "reachable": f"{sum(r['status'] == 'reachable' for r in a['rooms'])}/{n}",
                    "with_hinges": f"{sum(r['status'] == 'reachable' for r in h['rooms'])}/{n}", "problems": problems})
    res = {"chair_in": [chair_width_in, chair_length_in], "units": out}
    if len(sids) > MAX_CHECK:
        res["skipped"] = sids[MAX_CHECK:]           # say so; never drop a named unit silently
    return res


def aerial_check(sid: str) -> dict:
    """Outside check for a unit's building from Vexcel aerial imagery: accessible parking, curb ramps, walkways,
    exterior stairs, storeys. Every answer is yes / no / unclear and is an estimate from aerial imagery."""
    from engine.vexcel import aerial_check_unit
    try:
        return aerial_check_unit(sid)
    except Exception as e:                           # imagery or model unavailable: say so, never guess
        return {"sid": sid, "error": f"aerial check failed: {type(e).__name__}"}


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
Work in exactly four turns, and make the calls listed for a turn in ONE message so they run in parallel:
1. search_units (pass any unit id the person named in `include`).
2. task(geometry) with the 3 best sids plus any named unit, AND task(outside) for the best sid.
3. task(verifier) with the geometry answer, AND task(outreach) for the best unit with these questions: every unknown room's
   door width, every 'unclear' aerial item, and "Is the building entrance step-free, and is there an elevator?".
4. send_message with the outreach draft and recipient (a person must approve it; you cannot send without approval).
Then answer in at most 80 words: best unit(s) with rooms reachable as scanned and with hinges, and what is unknown.
Use the person's exact chair size. Never invent door widths, statistics or units; unknown stays unknown. Do not use file tools."""

SUB_RULES = " Use only tool results. Answer in at most 80 words. Never invent numbers."


def subagents(model: Any) -> list[dict]:
    return [
        {"name": "search", "description": "Finds candidate units from the ranked batch.",
         "system_prompt": "Call search_units once and return the sids with their counts." + SUB_RULES,
         "tools": [search_units], "model": model},
        {"name": "geometry", "description": "Drives the chair through several units (as scanned and with hinges) in one call.",
         "system_prompt": "Call check_units ONCE with all the sids and the person's chair size. Summarise each unit's blocked "
                          "or unknown rooms with the door width and shortfall exactly as returned." + SUB_RULES,
         "tools": [check_units], "model": model},
        {"name": "verifier", "description": "Labels each claim's basis and lists unknowns as questions.",
         "system_prompt": "Do not call tools. Label the claims you are given: door widths measured; clear widths, shortfalls "
                          "and turning circles estimated; the hinge gain (~1.75 in) assumed; rooms with no door unknown. "
                          "List the unknowns as questions." + SUB_RULES,
         "tools": [], "model": model},
        {"name": "general-purpose", "description": "Read-only helper for anything the other subagents do not cover.",
         "system_prompt": "Answer using the read-only tools. You cannot contact anyone." + SUB_RULES,
         "tools": [search_units, get_unit, check_units], "model": model},
        {"name": "outside", "description": "Checks a unit's building from Vexcel aerial imagery.",
         "system_prompt": "Call aerial_check once. Report each answer exactly as returned, labelled 'from aerial, estimated'. "
                          "Never upgrade unclear to yes." + SUB_RULES,
         "tools": [aerial_check], "model": model},
        {"name": "outreach", "description": "Drafts (never sends) a message to a leasing office.",
         "system_prompt": "Call draft_landlord_message once with the questions you are given and return the draft text and "
                          "recipient verbatim. You cannot send messages.",
         "tools": [draft_landlord_message], "model": model},
    ]


INTERRUPT_ON = {"send_message": {"allowed_decisions": ["approve", "reject"]}}
ORCHESTRATOR_TOOLS = [search_units, get_unit, check_units, draft_landlord_message, send_message]


def memory_permissions() -> list:
    """The agent's file tools may not read or write /memories/ (other senders' profiles); only agent.memory does.
    Subagents inherit these rules because none of them sets its own."""
    from deepagents.middleware.filesystem import FilesystemPermission
    return [FilesystemPermission(operations=["read", "write"], paths=["/memories/**", "/memories"], mode="deny")]


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
        prov = PROVIDERS[os.environ["MODEL_PROVIDER"].lower()]
        extra = {"thinking_budget": int(os.environ.get("ROLLIN_THINKING_BUDGET", "0"))} if prov == "google_genai" else {}
        model = init_chat_model(os.environ["MODEL_NAME"], model_provider=prov, **extra)
        from deepagents.backends import CompositeBackend, FilesystemBackend, StateBackend
        from agent.memory import memory_root
        memory_root().mkdir(parents=True, exist_ok=True)
        backend = CompositeBackend(default=StateBackend(),             # /memories/ = data/memory on disk (profiles)
                                   routes={"/memories/": FilesystemBackend(root_dir=memory_root(), virtual_mode=True)})
        _agent = create_deep_agent(model=model, tools=ORCHESTRATOR_TOOLS, system_prompt=SYSTEM,
                                   subagents=subagents(model), interrupt_on=INTERRUPT_ON, backend=backend,
                                   permissions=memory_permissions(), checkpointer=InMemorySaver(), name="rollin")
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


VISION_WORDS = {"bathtub": "bathtub", "roll_in_shower": "roll-in shower", "step_in_shower": "step-in shower",
                "unclear": "unclear", "yes": "yes", "no": "no"}


def vision_findings(sid: str) -> list[dict]:
    """Findings from data/cache/vision/<sid>.json (engine/vision.py). Missing or unreadable cache: none."""
    try:
        doc = json.loads((data_dir() / "cache" / "vision" / f"{sid}.json").read_text())
    except (OSError, ValueError):
        return []
    out = []
    for it in (doc.get("items") or []) if isinstance(doc, dict) else []:
        if not isinstance(it, dict) or not it.get("pano_id"):
            continue                                  # no panorama near the spot: nothing seen, nothing claimed
        ans = it.get("answers") or {}
        parts = [f"{k.replace('_', ' ')}: {VISION_WORDS.get(v.get('answer'), 'unclear')}" for k, v in ans.items()]
        where = f"{it['room']} door" if it.get("kind") == "door" else it["room"]
        numbers = {"pano_distance": num(it.get("pano_distance_m"), "measured", "m")}
        if it.get("door_in") is not None:
            numbers["door_width"] = num(it["door_in"], "measured", "in")
        out.append({"sid": sid, "room_id": it.get("room_id"), "room": it["room"], "status": it.get("status"),
                    "scenario": "panorama check", "label": "from defurnished panorama, estimated",
                    "text": f"{where}: {'; '.join(parts)} (from defurnished panorama, estimated)",
                    "numbers": numbers, "answers": ans,
                    "evidence": {"kind": "pano", "pano_id": it["pano_id"],
                                 "image_url": f"/api/vision/{sid}/{it['pano_id']}"}})
    return out


def findings_from_fit(res: dict, chair_w: float) -> list[dict]:
    """One finding per blocked/unknown room, numbers straight from the engine."""
    out = []
    for r in res.get("rooms", []):
        if r["status"] == "reachable":
            continue
        stop = r.get("blocking_door")
        widths = r["door_widths_in"]
        numbers = {"door_count": num(len(widths), "measured")}
        if widths:
            numbers["widest_door_width"] = num(max(widths), "measured", "in")
        if stop:
            numbers.update(blocking_door_width=num(stop["width_in"], "measured", "in"),
                           clear_width=num(stop["clear_in_est"], "estimated", "in"))
            if stop["clear_in_est"] < chair_w:             # a door that fits but a route too tight has no shortfall
                numbers["shortfall"] = num(round(chair_w - stop["clear_in_est"], 1), "estimated", "in")
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
            "Check the building outside from aerial imagery (outside)",
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
        self.found: dict[tuple[str, str, str], dict] = {}     # (sid, room_id, scenario) -> finding summary
        self.vision_done: set[str] = set()

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

    def vision_events(self, sid: str) -> list[dict]:
        """Cached panorama checks for a unit as findings (bathroom fixtures, thresholds), each citing its pano id."""
        if sid in self.vision_done:
            return []
        self.vision_done.add(sid)
        out = []
        for item in vision_findings(sid):
            self.found[(sid, f"pano:{item['evidence']['pano_id']}", "panorama check")] = {
                "room": item["room"], "status": item["status"], "turning": False}
            out.append(self.ev("finding", **item))
        return out

    def fit_events(self, data: dict, args: dict) -> list[dict]:
        """A run_fit result as a tool event plus one finding per blocked/unknown room (deduplicated)."""
        raw = {s: sum(1 for r in data["rooms"] if r["status"] == s) for s in ("reachable", "blocked", "unknown")}
        self.fits[(data["sid"], data["scenario"])] = {"name": data["name"], "counts": raw}
        out = [self.ev("tool", name="run_fit", status="done", args=wrap_args(args),
                       result={"sid": data["sid"], "scenario": data["scenario"], "counts": counts_of(data["rooms"])})]
        for f in findings_from_fit(data, float(data["chair_in"][0])):
            key = (f["sid"], f["room_id"], f["scenario"])
            if key not in self.seen_findings:
                self.seen_findings.add(key)
                self.found[key] = {"room": f["room"], "status": f["status"], "turning": "turning_circle" in f["numbers"]}
                out.append(self.ev(f.pop("type"), **f))
        return out + self.vision_events(data["sid"])

    def from_tool(self, m: Any) -> list[dict]:
        name, args = self.calls.get(getattr(m, "tool_call_id", "") or "", (getattr(m, "name", ""), {}))
        try:
            data = json.loads(text_of(m.content))
        except (ValueError, TypeError):
            data = None
        if name == "run_fit" and isinstance(data, dict) and "rooms" in data:
            return self.fit_events(data, args)
        if name == "search_units" and isinstance(data, dict):
            self.last_search = data
            return [self.ev("tool", name="search_units", status="done", args=wrap_args(args),
                            result={"candidates": num(data["candidates"], "measured"),
                                    "sids": [u["sid"] for u in data["units"]]})]
        if name == "check_units" and isinstance(data, dict) and "units" in data:
            w, l = data["chair_in"]
            out = [self.ev("tool", name="check_units", status="done", args=wrap_args(args),
                           result={"sids": [u["sid"] for u in data["units"]]})]
            for u in data["units"]:
                if "error" in u:
                    continue
                for hinges in (False, True):                    # same engine results the tool used (disk cache)
                    out += self.fit_events(run_fit(u["sid"], w, l, hinges), {"sid": u["sid"], "hinges": hinges})
            return out
        if name == "task":
            sub = args.get("subagent_type")
            text = text_of(m.content)
            if sub == "verifier":
                return [self.ev("verify", text=text, checked=self.checked(), questions=self.questions())]
            return [self.ev("tool", name="task", subagent=sub, status="done", result={"text": text})]
        if name == "aerial_check" and isinstance(data, dict) and "findings" in data:
            summary = "; ".join(f"{f['item'].replace('_', ' ')}: {f['answer']}" for f in data["findings"])
            return [self.ev("aerial", sid=data["sid"], text=f"From aerial, estimated. {summary}.",
                            image_url=f"/api/aerial/{data['sid']}", label="from aerial, estimated",
                            source=data.get("source"), numbers={"clip_size": num(data.get("clip_m"), "assumed", "m")},
                            evidence={"kind": "aerial"},
                            findings=[{k: f[k] for k in ("item", "question", "answer", "note", "basis", "label")}
                                      for f in data["findings"]])]
        if name == "aerial_check" and isinstance(data, dict) and "error" in data:
            return [self.ev("tool", name="aerial_check", status="error", args=wrap_args(args),
                            result={"sid": data.get("sid"), "error": data["error"]})]
        if name in ("get_unit", "draft_landlord_message"):
            return [self.ev("tool", name=name, status="done", args=wrap_args(args),
                            result=data if name == "draft_landlord_message" else {"sid": args.get("sid")})]
        return []

    def from_interrupt(self, interrupt: Any, thread: dict) -> list[dict]:
        """One approval per interrupt: the middleware needs one decision per batched request, all at once."""
        reqs = interrupt.value.get("action_requests", [])
        msgs = [{"to": r["args"].get("to"), "draft": with_ai_disclosure(r["args"].get("text", ""))}
                for r in reqs if r.get("name") == "send_message"]
        if not msgs:
            return []
        action_id = f"act_{self.run_id}_{len(self.pending) + 1}"
        approvals.register(approvals.Pending(
            action_id=action_id, run_id=self.run_id, action="send_message", payload={"messages": msgs},
            on_resolve=lambda approved, t=thread, n=len(reqs), m=msgs: resume(t, approved, n, m)))
        self.pending.append(action_id)
        if len(msgs) == 1:
            draft = msgs[0]["draft"]
        else:
            draft = "\n\n".join(f"Message {i} to {x['to']}:\n{x['draft']}" for i, x in enumerate(msgs, 1))
        return [self.ev("approval_needed", action_id=action_id, action="send_message", to={"label": msgs[0]["to"]},
                        draft=draft, messages=msgs, reason="Outbound messages always need a person's approval.")]

    def checked(self) -> list[dict]:
        """Basis of every kind of claim this run has made so far (from engine output, not model text)."""
        out = [{"claim": "Door widths from the scan", "basis": "measured"},
               {"claim": "Clear widths (opening minus ~5 cm for door leaf and stop)", "basis": "estimated"}]
        if any(sc != "as scanned" for _, sc in self.fits):
            out.append({"claim": "Offset hinges add about 1.75 in of clear width", "basis": "assumed"})
        if any(f.get("turning") for f in self.found.values()):
            out.append({"claim": "Bathroom turning circle", "basis": "estimated", "note": "walls only"})
        if self.vision_done and any(k[2] == "panorama check" for k in self.found):
            out.append({"claim": "Bathroom fixtures and thresholds from defurnished panoramas", "basis": "estimated"})
        if any(f["status"] == "unknown" for f in self.found.values()):
            out.append({"claim": "Rooms with no measured door", "basis": "unknown"})
        return out

    def questions(self) -> list[str]:
        qs = []
        for (sid, _rid, sc), f in self.found.items():
            if f["status"] == "unknown" and sc == "as scanned":
                name = self.fits.get((sid, "as scanned"), {}).get("name", sid)
                qs.append(f"What is the clear width of the {f['room'].lower()} door in {name}?")
        return qs + ["Is the building entrance step-free, and is there an elevator?"]

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


def _queued(msgs: list[dict], since: set[str]) -> int:
    """How many of these exact messages landed in the outbox after `since` (a listing taken before resuming)."""
    box = data_dir() / "outbox"
    if not box.exists():
        return 0
    want = {(m["to"], m["draft"]) for m in msgs}
    n = 0
    for p in box.glob("*.json"):
        if p.name not in since:
            rec = json.loads(p.read_text())
            n += (rec.get("to"), rec.get("text")) in want
    return n


def resume(thread: dict, approved: bool, n_requests: int = 1, msgs: list[dict] | None = None) -> dict:
    """Called by POST /api/approve: continue the paused graph with the person's decision for every batched request.
    The status comes from the outbox, so a model error after queueing cannot report a queued message as unsent."""
    from langgraph.types import Command
    msgs = msgs or []
    box = data_dir() / "outbox"
    before = {p.name for p in box.glob("*.json")} if box.exists() else set()
    decision = {"type": "approve"} if approved else {"type": "reject", "message": "The case manager declined."}
    error, final_text = None, ""
    try:
        out = get_agent().invoke(Command(resume={"decisions": [decision] * n_requests}), thread)
        final_text = text_of(out["messages"][-1].content)
    except Exception as e:                          # decide below whether anything was queued
        error = type(e).__name__
    queued = _queued(msgs, before) if approved else 0
    if error and not queued:
        raise RuntimeError(f"agent failed before queueing: {error}")
    if queued:
        status = (f"queued {queued} of {len(msgs)} message(s) in the outbox for the messaging bridge "
                  "(not delivered by the agent)")
    else:
        status = "approved, but the agent did not queue a message" if approved else "declined: nothing sent"
    res = {"status": status, "queued": queued, "final_text": final_text}
    if error:
        res["warning"] = f"the agent stopped after queueing ({error}); the queued message stands"
    return res


def memory_event(sender_id: str, mem: dict) -> dict:
    """What profile memory did, in words and with the chair size labelled by where it came from."""
    from agent.memory import key_for
    w, l = mem["chair_in"]
    text = {"used": (f"Using the {w:g}x{l:g} in chair from your last request." if mem["source"] == "memory" else
                     f"Your {w:g}x{l:g} in chair matches your saved profile."),
            "saved": f"Saved your {w:g}x{l:g} in chair for next time.",
            "updated": (f"Updated your chair to {w:g}x{l:g} in (was {mem['previous'][0]:g}x{mem['previous'][1]:g} in)."
                        if mem.get("previous") else f"Updated your chair to {w:g}x{l:g} in.")}[mem["action"]]
    return {"sender_id": sender_id, "action": mem["action"], "text": text,
            "path": f"/memories/profiles/{key_for(sender_id)}.json",
            "profile": {"chair_in": [num(v, "asked", "in", source=mem["source"]) for v in mem["chair_in"]]}}


async def run_agent(message: str, profile: dict, run_id: str) -> AsyncIterator[dict]:
    """Live runner for POST /api/chat."""
    agent = get_agent()
    thread = {"configurable": {"thread_id": run_id}, "recursion_limit": 120,
              "metadata": {"run_id": run_id}, "run_name": "rollin-chat"}
    from agent import memory
    profile, mem = memory.resolve(message, profile)
    r = Run(run_id)
    plan = {"text": "Orchestrator pipeline", "source": "orchestrator",
            "todos": [{"id": f"t{i}", "text": t, "status": "pending"} for i, t in enumerate(PIPELINE, 1)]}
    if profile.get("chair_in") or profile.get("sender_id"):
        src = (mem or {}).get("source", "user")
        plan["profile"] = {"sender_id": profile.get("sender_id"),
                           "chair_in": [num(v, "asked", "in", source=src) for v in profile.get("chair_in") or []]}
    yield r.ev("plan", **plan)
    if mem:
        yield r.ev("memory", **memory_event(profile["sender_id"], mem))
    note = (" (chair size from this person's saved profile)" if mem and mem["source"] == "memory" else "")
    for_model = {k: v for k, v in profile.items() if k != "sender_id"}      # the model never sees who is asking
    prompt = message if not for_model else f"{message}\n\nProfile{note}: {json.dumps(for_model)}"
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
