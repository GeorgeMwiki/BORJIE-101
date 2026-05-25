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
    )
