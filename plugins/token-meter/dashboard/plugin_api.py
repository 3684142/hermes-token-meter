"""Token Meter plugin — backend API routes (hot-reload loader).

Mounted at /api/plugins/token-meter/ by the Hermes dashboard web server
(``hermes serve``), which the desktop app spawns as its backend.

HOT RELOAD
----------
All query logic lives in ``impl.py`` next to this file. Every request checks
that file's mtime and re-imports it when it changed, so editing ``impl.py``
takes effect on the NEXT request — no desktop restart needed. (Only this
router file itself still requires a restart to change, and it should stay
as a thin stable shell.)

Data source
-----------
Reads the Hermes session store (state.db) READ-ONLY. ``session_model_usage``
is keyed per (session_id, model), so impl.py aggregates across model rows;
see its docstring.

Read-only guarantee: the DB is opened with ``mode=ro``; this module never
writes to state.db, never mutates config, and never touches Hermes core.

Security
--------
Runs inside the dashboard plugin sandbox: routes are scoped to
``/api/plugins/token-meter/*`` by construction, session-token authed like
every plugin API route. No secrets, no file writes.
"""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query

log = logging.getLogger(__name__)
router = APIRouter()

_IMPL_PATH = Path(__file__).resolve().parent / "impl.py"
_IMPL_MODULE_NAME = "hermes_dashboard_plugin_token_meter_impl"

_impl = None
_impl_mtime = None


def _load_impl():
    """Import impl.py, re-importing when the file changed on disk."""
    global _impl, _impl_mtime
    try:
        mtime = _IMPL_PATH.stat().st_mtime
        if _impl is None or mtime != _impl_mtime:
            _impl_mtime = mtime
            spec = importlib.util.spec_from_file_location(_IMPL_MODULE_NAME, _IMPL_PATH)
            if spec is None or spec.loader is None:
                log.warning("token-meter: impl.py spec failed")
                return _impl
            mod = importlib.util.module_from_spec(spec)
            sys.modules[_IMPL_MODULE_NAME] = mod
            spec.loader.exec_module(mod)
            _impl = mod
            log.info("token-meter: impl.py loaded (mtime %.3f)", mtime)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("token-meter: impl.py reload failed: %s", exc)
        # Keep serving with the previous impl on transient errors.
        if _impl is None:
            # Last resort: a static empty response so the API never 500s.
            return None
    return _impl


@router.get("/live")
def live(session_id: Optional[str] = Query(default=None)):
    """Current usage snapshot of the active (or requested) session."""
    impl = _load_impl()
    if impl is None:
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
    return impl.live(session_id)
