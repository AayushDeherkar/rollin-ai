"""Approval gate for outbound actions (send_message, ...).

Nothing outbound runs until POST /api/approve resolves its action_id with approved=true.
The agent registers a pending action with an on_resolve callback; replayed runs register
with replay=True and nothing is ever sent for them.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Pending:
    action_id: str
    run_id: str
    action: str
    payload: dict
    replay: bool = False
    created: float = field(default_factory=time.time)
    approved: bool | None = None
    result: dict | None = None
    on_resolve: Callable[[bool], dict] | None = None


_pending: dict[str, Pending] = {}
_lock = threading.Lock()


class UnknownAction(KeyError):
    pass


class AlreadyResolved(RuntimeError):
    pass


class DuplicateAction(RuntimeError):
    pass


class ActionFailed(RuntimeError):
    pass


def register(p: Pending) -> Pending:
    """Register once: an id can never be reset to undecided (that could send twice)."""
    with _lock:
        if p.action_id in _pending:
            raise DuplicateAction(p.action_id)
        _pending[p.action_id] = p
    return p


def get(action_id: str) -> Pending | None:
    return _pending.get(action_id)


def resolve(action_id: str, approved: bool) -> dict[str, Any]:
    """Record the decision once, then run the action's callback (live runs only)."""
    with _lock:
        p = _pending.get(action_id)
        if p is None:
            raise UnknownAction(action_id)
        if p.approved is not None:
            raise AlreadyResolved(action_id)
        p.approved = approved
    if p.replay:
        p.result = {"status": "not sent: replayed run", "replay": True}
    elif p.on_resolve is not None:
        try:
            p.result = p.on_resolve(approved)
        except Exception as e:                      # the decision did not take effect: allow a retry
            with _lock:
                p.approved = None
            raise ActionFailed(f"{p.action}: {type(e).__name__}") from e
    else:
        p.result = {"status": "approved, but no live agent is attached" if approved else "declined"}
    return {"action_id": action_id, "approved": approved, "action": p.action, "run_id": p.run_id, **p.result}


def clear() -> None:
    with _lock:
        _pending.clear()
