"""pm4py sidecar package — AGPL-3.0 segregated from the MIT TS host.

This package is intentionally minimal: it only exposes `server.py`,
which reads JSON-line commands from stdin and writes JSON-line results
to stdout. No symbols from this package are imported by the TypeScript
side — the boundary is the OS-level process.
"""
