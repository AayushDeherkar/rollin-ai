"""Profile memory per sender, kept in the agent's filesystem memory.

The agent's virtual path /memories/ is a deepagents FilesystemBackend rooted at data/memory/ (gitignored), so a
profile saved here is the file the agent sees at /memories/profiles/<key>.json. <key> is a hash of sender_id, so
raw phone handles never become filenames.

Rules: a chair size stated now (profile.chair_in or in the message) wins and is saved; otherwise the saved size is
reused and reported. Nothing is remembered without a sender_id.
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

FIELDS = ("chair_in", "turning_in", "needs", "budget", "area", "beds")
# "27 x 42", "27x42 in", "27 by 42 inches", "27 inches wide and 42 inches long"
SIZE_PAIR = re.compile(r"(\d{2}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|\"|”)?\s*(?:wide\s*)?(?:x|×|by)\s*(\d{2}(?:\.\d+)?)", re.I)
SIZE_WORDS = re.compile(r"(\d{2}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|\"|”)\s*wide\b.*?(\d{2}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|\"|”)\s*long",
                        re.I | re.S)


def memory_root() -> pathlib.Path:
    return data_dir() / "memory"


def key_for(sender_id: str) -> str:
    return hashlib.sha256(sender_id.encode("utf-8")).hexdigest()[:16]


def path_for(sender_id: str) -> pathlib.Path:
    return memory_root() / "profiles" / f"{key_for(sender_id)}.json"


def chair_from_message(message: str) -> list[float] | None:
    """A chair size the person states in plain words, as [width, length] inches; None if not stated."""
    for rx in (SIZE_WORDS, SIZE_PAIR):
        m = rx.search(message or "")
        if m:
            w, l = float(m.group(1)), float(m.group(2))
            if 15 <= w <= 45 and 25 <= l <= 70 and w < l:     # plausible wheelchair sizes only
                return [w, l]
    return None


def load(sender_id: str) -> dict:
    p = path_for(sender_id)
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except (ValueError, OSError):
        return {}


def save(sender_id: str, profile: dict) -> None:
    p = path_for(sender_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {k: profile[k] for k in FIELDS if profile.get(k) is not None}
    rec["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = p.with_suffix(f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(rec, indent=1))
    os.replace(tmp, p)


def resolve(message: str, profile: dict | None) -> tuple[dict, dict | None]:
    """The profile to use for this run, and what memory did ("saved", "updated", "used") or None."""
    profile = dict(profile or {})
    sender = profile.get("sender_id")
    stated = profile.get("chair_in") or chair_from_message(message)
    if not sender:
        if stated:
            profile["chair_in"] = stated
        return profile, None
    saved = load(sender)
    merged = {**{k: v for k, v in saved.items() if k in FIELDS},
              **{k: v for k, v in profile.items() if k in FIELDS and v is not None}, "sender_id": sender}
    if stated:
        merged["chair_in"] = [float(x) for x in stated]
        before = saved.get("chair_in")
        action = "saved" if not before else "updated" if before != merged["chair_in"] else "used"
        if action != "used":
            save(sender, merged)
        out = {"action": action, "chair_in": merged["chair_in"], "source": "user"}
        if action == "updated":
            out["previous"] = before
        return merged, out
    if saved.get("chair_in"):
        return merged, {"action": "used", "chair_in": saved["chair_in"], "source": "memory",
                        "saved_at": saved.get("updated_at")}
    return merged, None
