#!/usr/bin/env python3
"""
pm4py sidecar — JSON-line server.

Protocol
========
- Reads one JSON object per line from stdin: {id, kind, args}
- Writes one JSON object per line to stdout: {id, ok, data?, error?, errorCode?}
- Logs go to stderr (never stdout — would corrupt the frame protocol)

Each `kind` maps to a pm4py operation:
  - get_processes              -> list discovered process ids
  - get_bottleneck_analysis    -> performance DFG, top-K slow edges
  - get_variants_with_metrics  -> trace variants + frequency + duration
  - get_correlation            -> Pearson / Cramer V vs cycle time
  - get_conformance            -> token replay (IMf happy path or supplied PNML)
  - get_loop_analysis          -> self / short / long loops
  - get_handoff_matrix         -> social network of work + centrality
  - get_cycle_time_distribution-> histogram + percentiles
  - get_drift_alerts           -> concept drift across windows

LICENSE
=======
pm4py is AGPL-3.0. This sidecar process is isolated from the MIT-licensed
TypeScript host by the OS process boundary (stdin / stdout pipes). Do not
import pm4py symbols into the TypeScript codebase and do not bundle this
file into the TS distribution.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, Dict


# ---------------------------------------------------------------------------
# pm4py is imported lazily — when the sidecar is invoked in a test or a
# slim container without pm4py installed, we still want to be able to
# respond with a structured error rather than crashing on import.
# ---------------------------------------------------------------------------

_PM4PY_LOADED: bool = False
_PM4PY_IMPORT_ERROR: str | None = None


def _ensure_pm4py() -> bool:
    """Lazy-import pm4py. Returns True if successful, False otherwise."""
    global _PM4PY_LOADED, _PM4PY_IMPORT_ERROR
    if _PM4PY_LOADED:
        return True
    if _PM4PY_IMPORT_ERROR is not None:
        return False
    try:
        import pm4py  # noqa: F401  (intentional — verifies install only)
        _PM4PY_LOADED = True
        return True
    except Exception as exc:  # broad on purpose — also catches OSError on JVM
        _PM4PY_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        return False


# ---------------------------------------------------------------------------
# Frame I/O
# ---------------------------------------------------------------------------


def _log(msg: str) -> None:
    sys.stderr.write(f"[pm4py-sidecar] {msg}\n")
    sys.stderr.flush()


def _write_response(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Per-kind handlers
#
# These implementations are intentionally STUBS — they return the
# correct response shape so the TS-side typecheck + unit tests pass.
# The full pm4py wiring (event-log fetch, IMf discovery, token replay,
# DFG performance, drift detection) is added in Phase E.3 once the
# event-bus tap is in place. The shapes here are stable and match the
# TS-side `outputSchema` for each tool, so handlers will not need to
# change when the real pm4py code lands.
# ---------------------------------------------------------------------------


def _handle_get_processes(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"processes": []}


def _handle_get_bottleneck(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"processId": args.get("processId", ""), "edges": []}


def _handle_get_variants(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "processId": args.get("processId", ""),
        "totalCases": 0,
        "variants": [],
    }


def _handle_get_correlation(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "processId": args.get("processId", ""),
        "target": args.get("target", "cycle_time"),
        "correlations": [],
    }


def _handle_get_conformance(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "processId": args.get("processId", ""),
        "fitness": 0.0,
        "precision": 0.0,
        "generalisation": 0.0,
        "simplicity": 0.0,
        "violations": [],
    }


def _handle_get_loops(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"processId": args.get("processId", ""), "patterns": []}


def _handle_get_handoff(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "processId": args.get("processId", ""),
        "handoffs": [],
        "centrality": [],
    }


def _handle_get_cycle_time(args: Dict[str, Any]) -> Dict[str, Any]:
    zero_stats = {
        "minSeconds": 0.0,
        "meanSeconds": 0.0,
        "medianSeconds": 0.0,
        "p90Seconds": 0.0,
        "p95Seconds": 0.0,
        "p99Seconds": 0.0,
        "maxSeconds": 0.0,
        "stdDevSeconds": 0.0,
    }
    return {
        "processId": args.get("processId", ""),
        "totalCases": 0,
        "stats": zero_stats,
        "buckets": [],
    }


def _handle_get_drift(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "processId": args.get("processId", ""),
        "windowSize": args.get("windowSize", "monthly"),
        "alerts": [],
    }


_HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "get_processes": _handle_get_processes,
    "get_bottleneck_analysis": _handle_get_bottleneck,
    "get_variants_with_metrics": _handle_get_variants,
    "get_correlation": _handle_get_correlation,
    "get_conformance": _handle_get_conformance,
    "get_loop_analysis": _handle_get_loops,
    "get_handoff_matrix": _handle_get_handoff,
    "get_cycle_time_distribution": _handle_get_cycle_time,
    "get_drift_alerts": _handle_get_drift,
}


# ---------------------------------------------------------------------------
# Dispatch loop
# ---------------------------------------------------------------------------


def _dispatch(cmd: Dict[str, Any]) -> Dict[str, Any]:
    cmd_id = cmd.get("id", "")
    kind = cmd.get("kind", "")
    args = cmd.get("args", {}) or {}

    if not cmd_id:
        return {
            "id": "",
            "ok": False,
            "error": "missing command id",
            "errorCode": "VALIDATION",
        }

    handler = _HANDLERS.get(kind)
    if handler is None:
        return {
            "id": cmd_id,
            "ok": False,
            "error": f"unknown kind '{kind}'",
            "errorCode": "UNKNOWN_KIND",
        }

    # Allow stub responses without pm4py installed (CI / tests don't
    # need the heavy stack). The real handlers will require pm4py and
    # surface a structured error when not present.
    if not _ensure_pm4py():
        _log(f"pm4py not available, returning empty-stub for {kind}")

    try:
        data = handler(args)
        return {"id": cmd_id, "ok": True, "data": data}
    except Exception as exc:  # noqa: BLE001 — boundary point
        _log(f"handler {kind} crashed: {exc}\n{traceback.format_exc()}")
        return {
            "id": cmd_id,
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "errorCode": "HANDLER_CRASH",
        }


def main() -> None:
    _log("pm4py sidecar started, awaiting commands on stdin")
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_response(
                {
                    "id": "",
                    "ok": False,
                    "error": f"invalid JSON frame: {exc}",
                    "errorCode": "BAD_FRAME",
                }
            )
            continue
        response = _dispatch(cmd)
        _write_response(response)


if __name__ == "__main__":
    main()
