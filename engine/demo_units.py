"""Real demo units are referenced only through aliases kept in the gitignored data/demo_units.json:

    {"demo-main": "<sid>", "demo-backup": "<sid>", "demo-pass": "<sid>", "demo-sparse": "<sid>",
     "extra": ["<sid>", ...], "expect": {"demo-main": {"flips_with_hinges": [...], "stays_blocked": [...]}}}

No real model id, unit name or result lives in tracked files. Every CLI accepts an alias where it takes a sid.
"""
from __future__ import annotations

import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ALIASES = ("demo-main", "demo-backup", "demo-pass", "demo-sparse")


def path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROLLIN_DATA_DIR") or ROOT / "data") / "demo_units.json"


def load() -> dict:
    try:
        d = json.loads(path().read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def resolve(name: str) -> str:
    """The sid for an alias (demo-main, ...); anything else is returned unchanged."""
    d = load()
    sid = d.get(name) if name in ALIASES else None
    if name in ALIASES and not isinstance(sid, str):
        raise SystemExit(f"{name} is not set in {path()} (gitignored; ask a teammate for it)")
    return sid or name


def demo_sids() -> list[str]:
    """The demo units in alias order, then any extras; empty if the file is absent."""
    d = load()
    sids = [d[a] for a in ALIASES if isinstance(d.get(a), str)]
    return list(dict.fromkeys(sids + [s for s in d.get("extra", []) if isinstance(s, str)]))
