"""Env-driven config.

Keep this minimal — the sidecar is stateless and config-light by design.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Immutable settings snapshot built from env at startup."""

    host: str
    port: int
    log_level: str
    bootstrap_samples: int
    dowhy_simulations: int
    pcmci_tau_max_default: int
    pcmci_pc_alpha_default: float
    max_payload_rows: int
    cors_allow_origins: tuple[str, ...]
    # SEC-1 — shared-secret bearer token. When set, every inference route
    # (/dowhy/*, /tigramite/*) requires `Authorization: Bearer <token>`.
    # Sourced from KMS via ESO; NEVER hardcoded. Empty == auth disabled
    # (local dev only — the deployment always injects a real token).
    auth_token: str
    # SEC-2 — in prod the sidecar shares NO data volume with tenants, so
    # only `inline://` and `rows://` dataRefs are valid. Local file schemes
    # (`csv://`, `parquet://`) are rejected unless this flag is explicitly
    # enabled (local dev / batch backfill nodes that DO mount a volume).
    allow_local_paths: bool
    # SEC-2 — hard cap on the request body size (bytes) so a caller cannot
    # OOM the sidecar with a giant inline:// payload before row-capping.
    max_payload_bytes: int


def _read_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _read_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _read_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _read_csv_env(name: str) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    if not raw:
        return ()
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def load_settings() -> Settings:
    """Read env vars into a frozen Settings instance."""
    return Settings(
        host=os.getenv("DISCOVERY_SIDECAR_HOST", "0.0.0.0"),
        port=_read_int("DISCOVERY_SIDECAR_PORT", 8000),
        log_level=os.getenv("DISCOVERY_SIDECAR_LOG_LEVEL", "info"),
        bootstrap_samples=_read_int("DISCOVERY_SIDECAR_BOOTSTRAP_SAMPLES", 50),
        dowhy_simulations=_read_int("DISCOVERY_SIDECAR_DOWHY_SIMULATIONS", 50),
        pcmci_tau_max_default=_read_int("DISCOVERY_SIDECAR_PCMCI_TAU_MAX", 5),
        pcmci_pc_alpha_default=_read_float("DISCOVERY_SIDECAR_PCMCI_ALPHA", 0.05),
        max_payload_rows=_read_int("DISCOVERY_SIDECAR_MAX_ROWS", 500_000),
        cors_allow_origins=_read_csv_env("DISCOVERY_SIDECAR_CORS_ORIGINS"),
        auth_token=os.getenv("DISCOVERY_SIDECAR_AUTH_TOKEN", ""),
        allow_local_paths=_read_bool("DISCOVERY_SIDECAR_ALLOW_LOCAL_PATHS", False),
        max_payload_bytes=_read_int(
            "DISCOVERY_SIDECAR_MAX_PAYLOAD_BYTES", 64 * 1024 * 1024
        ),
    )
