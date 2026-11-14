"""Chair-size memory per sender, kept in the agent's filesystem memory.

The agent's virtual path /memories/ is a deepagents FilesystemBackend rooted at data/memory/ (gitignored); a sender's
profile is the file /memories/profiles/<key>.json there, where <key> is a hash of sender_id (raw handles never become
filenames). Only this module reads and writes those files: the agent's own file tools are denied on /memories/ (see
agent.get_agent), so no request can list, read or edit another sender's profile.

What is remembered: the chair size only. A size stated now (a valid profile.chair_in, or a size clearly given for the
chair in the message) wins and is saved; otherwise the saved size is reused and reported. Nothing is remembered
without a string sender_id. Bad input is ignored, never saved.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import uuid
from datetime import datetime, timezone

from agent.chat import data_dir

NUM = r"(?<![\d.#])(\d{2}(?:\.\d+)?)(?![\d.])"
INCH = r"(?:\s*(?:in(?:ch(?:es)?)?\b|\"|”))?"
NOT_CHAIR_UNIT = r"(?!\s*(?:ft|feet|foot|'|cm|mm|m\b|meters?|sq|square|min|minutes?|mi|miles?|km|%|\$))"
# "26x40", "26 x 40 in", "26 by 40 inches"
SIZE_PAIR = re.compile(NUM + INCH + NOT_CHAIR_UNIT + r"\s*(?:wide\s*)?(?:x|×|by)\s*" + NUM + INCH + NOT_CHAIR_UNIT, re.I)
# "26 inches wide and 40 inches long" (the two halves within 30 characters)
SIZE_WORDS = re.compile(NUM + r"\s*(?:in(?:ch(?:es)?)?|\"|”)\s*wide\b(?:(?!\bwide\b)\D){0,30}?" + NUM + r"\s*(?:in(?:ch(?:es)?)?|\"|”)\s*long\b",
                        re.I | re.S)
CHAIR_WORD = re.compile(r"\b(?:chair|wheelchair|power ?chair|scooter|mobility device|walker)\b", re.I)


def memory_root() -> pathlib.Path:
    return data_dir() / "memory"


def key_for(sender_id: str) -> str:
    return hashlib.sha256(sender_id.encode("utf-8")).hexdigest()[:16]


def path_for(sender_id: str) -> pathlib.Path:
    return memory_root() / "profiles" / f"{key_for(sender_id)}.json"


def valid_chair(value: object) -> list[float] | None:
    """[width, length] in inches if plausible for a wheelchair, else None."""
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        w, l = float(value[0]), float(value[1])
    except (TypeError, ValueError):
        return None
    return [w, l] if 15 <= w <= 45 and 25 <= l <= 70 and w < l else None


def chair_from_message(message: str) -> list[float] | None:
    """A chair size the person states in plain words, as [width, length] inches; None if not clearly stated.
    Only a plausible size within 40 characters of a chair word counts (so shower, patio or room sizes don't)."""
    text = message or ""
    for rx in (SIZE_WORDS, SIZE_PAIR):
        for m in rx.finditer(text):
            size = valid_chair([m.group(1), m.group(2)])
            near = text[max(0, m.start() - 40): m.end() + 40]
            if size and CHAIR_WORD.search(near):
                return size
    return None


def load(sender_id: str) -> list[float] | None:
    """The saved chair size, or None if there is none or the file is unusable."""
    try:
        rec = json.loads(path_for(sender_id).read_text())
    except (OSError, ValueError):
        return None
    return valid_chair(rec.get("chair_in")) if isinstance(rec, dict) else None


def save(sender_id: str, chair: list[float]) -> str:
    p = path_for(sender_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = p.with_suffix(f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps({"chair_in": chair, "updated_at": stamp}, indent=1))
    os.replace(tmp, p)
    return stamp


def saved_at(sender_id: str) -> str | None:
    try:
        rec = json.loads(path_for(sender_id).read_text())
        return rec.get("updated_at") if isinstance(rec, dict) else None
    except (OSError, ValueError):
        return None


def resolve(message: str, profile: dict | None) -> tuple[dict, dict | None]:
    """The profile to use for this run, and what memory did ("saved", "updated", "used") or None."""
    profile = dict(profile) if isinstance(profile, dict) else {}
    given = valid_chair(profile.get("chair_in"))
    profile.pop("chair_in", None)                     # re-added below only if valid
    sender = profile.get("sender_id")
    if not isinstance(sender, str) or not sender.strip():
        profile.pop("sender_id", None)
        sender = None
    stated = given or chair_from_message(message)
    if stated:
        profile["chair_in"] = stated
    if not sender:
        return profile, None
    before = load(sender)
    if stated:
        action = "saved" if not before else "updated" if before != stated else "used"
        if action != "used":
            save(sender, stated)
        out = {"action": action, "chair_in": stated, "source": "user"}
        if action == "updated":
            out["previous"] = before
        return profile, out
    if before:
        profile["chair_in"] = before
        return profile, {"action": "used", "chair_in": before, "source": "memory", "saved_at": saved_at(sender)}
    return profile, None
