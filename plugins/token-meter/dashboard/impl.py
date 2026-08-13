"""Token Meter — hot-reloadable implementation.

This file holds ALL the query logic for the token-meter backend. The router
(plugin_api.py) checks this file's mtime on every request and re-imports it
when it changes, so editing impl.py takes effect without restarting the
Hermes desktop backend (hot reload).

Keep this file dependency-light: stdlib + sqlite3 only.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

DEFAULT_HERMES_HOME = Path.home() / ".hermes"


def _hermes_home() -> Path:
    """Resolve HERMES_HOME the same way Hermes itself does (env wins)."""
    env = os.environ.get("HERMES_HOME")
    if env and env.strip():
        return Path(env.strip()).expanduser()
    return DEFAULT_HERMES_HOME


def _state_db_path() -> Path:
    return _hermes_home() / "state.db"


def _iso(ts: Any) -> Optional[str]:
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        return str(ts)
    except Exception:
        return None


def live(session_id: Optional[str]) -> Dict[str, Any]:
    """Return the usage for the requested session, or the most recently
    active session when no id is given.

    IMPORTANT: ``session_model_usage`` is keyed per (session_id, model); one
    conversation that switches models (e.g. deepseek -> glm fallback) spans
    several rows. We therefore AGGREGATE across all model rows of a session
    so the totals never jump when the model switches mid-conversation. The
    reported ``model`` is the one of the most recently seen row.
    """
    db_path = _state_db_path()
    if not db_path.exists():
        return _empty(session_id)
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
        try:
            cur = conn.cursor()
            if not session_id:
                # Most recently active session = max(last_seen) across rows.
                cur.execute(
                    "SELECT session_id FROM session_model_usage "
                    "ORDER BY last_seen DESC LIMIT 1"
                )
                row = cur.fetchone()
                if not row:
                    return _empty(session_id)
                session_id = row[0]
            # Aggregate all model rows of the session.
            cur.execute(
                """SELECT session_id,
                          SUM(api_call_count),
                          SUM(input_tokens),
                          SUM(output_tokens),
                          SUM(cache_read_tokens),
                          SUM(cache_write_tokens),
                          SUM(reasoning_tokens),
                          MIN(first_seen),
                          MAX(last_seen)
                   FROM session_model_usage
                   WHERE session_id = ?
                   GROUP BY session_id""",
                (session_id,),
            )
            agg = cur.fetchone()
            if not agg:
                return _empty(session_id)
            # Model of the most recently seen row (the one the user is on).
            cur.execute(
                "SELECT model FROM session_model_usage "
                "WHERE session_id = ? ORDER BY last_seen DESC LIMIT 1",
                (session_id,),
            )
            mrow = cur.fetchone()
            model = mrow[0] if mrow else ""
            return {
                "session_id": agg[0],
                "model": model,
                "calls": int(agg[1] or 0),
                "input": int(agg[2] or 0),
                "output": int(agg[3] or 0),
                "cache_read": int(agg[4] or 0),
                "cache_write": int(agg[5] or 0),
                "reasoning": int(agg[6] or 0),
                "total": int(agg[2] or 0) + int(agg[3] or 0),
                "first_seen": _iso(agg[7]),
                "last_seen": _iso(agg[8]),
            }
        finally:
            conn.close()
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("token-meter: state.db read failed: %s", exc)
        return _empty(session_id)


def _empty(session_id: Optional[str]) -> Dict[str, Any]:
    return {
        "session_id": session_id,
        "model": "",
        "calls": 0,
        "input": 0,
        "output": 0,
        "cache_read": 0,
        "cache_write": 0,
        "reasoning": 0,
        "total": 0,
        "first_seen": None,
        "last_seen": None,
    }
