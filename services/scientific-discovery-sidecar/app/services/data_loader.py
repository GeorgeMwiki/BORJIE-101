"""Resolve `dataRef` strings into pandas DataFrames.

Supported schemes:

  - `inline://<base64-encoded-CSV>`   — for small ad-hoc payloads
  - `csv://<absolute-path>`           — local CSV file
  - `parquet://<absolute-path>`       — local parquet file
  - `rows://<json-array-of-objects>`  — for tiny test fixtures

All paths are sandboxed via existence checks; we never download from
URLs (that would let a caller probe the sidecar's network).
"""

from __future__ import annotations

import base64
import io
import json
import os

import pandas as pd

INLINE_PREFIX = "inline://"
CSV_PREFIX = "csv://"
PARQUET_PREFIX = "parquet://"
ROWS_PREFIX = "rows://"


class DataRefError(ValueError):
    """Raised when a `dataRef` is malformed or refers to a missing file."""


def load_dataframe(
    data_ref: str,
    max_rows: int,
    *,
    allow_local_paths: bool = False,
    max_bytes: int | None = None,
) -> pd.DataFrame:
    """Resolve a `dataRef` into a pandas DataFrame.

    Args:
        data_ref: One of the supported scheme prefixes above.
        max_rows: Hard cap on rows — protects the sidecar from OOM.
        allow_local_paths: SEC-2 — when ``False`` (the prod default) the
            file-backed schemes ``csv://`` and ``parquet://`` are
            REJECTED. In prod the sidecar shares no data volume with any
            tenant, so the only valid schemes are ``inline://`` and
            ``rows://`` (data the calling, tenant-scoped gateway resolved
            and embedded). This closes a cross-tenant / arbitrary-file
            read vector.
        max_bytes: SEC-2 — optional hard cap on the inline payload size in
            bytes, applied BEFORE parsing so a giant ``inline://`` body
            cannot OOM the process ahead of the row cap.

    Raises:
        DataRefError: On any malformed input, missing file, oversized
            payload, or a disallowed local-path scheme.
    """
    if not isinstance(data_ref, str) or not data_ref:
        raise DataRefError("dataRef must be a non-empty string")

    if data_ref.startswith(INLINE_PREFIX):
        body = data_ref[len(INLINE_PREFIX) :]
        _enforce_byte_cap(body, max_bytes)
        return _load_inline_csv(body, max_rows)

    if data_ref.startswith(ROWS_PREFIX):
        body = data_ref[len(ROWS_PREFIX) :]
        _enforce_byte_cap(body, max_bytes)
        return _load_inline_rows(body, max_rows)

    if data_ref.startswith(CSV_PREFIX):
        if not allow_local_paths:
            raise DataRefError(_LOCAL_PATH_REJECTED.format(scheme=CSV_PREFIX))
        path = data_ref[len(CSV_PREFIX) :]
        return _load_csv_file(path, max_rows)

    if data_ref.startswith(PARQUET_PREFIX):
        if not allow_local_paths:
            raise DataRefError(_LOCAL_PATH_REJECTED.format(scheme=PARQUET_PREFIX))
        path = data_ref[len(PARQUET_PREFIX) :]
        return _load_parquet_file(path, max_rows)

    raise DataRefError(
        f"dataRef scheme not recognised; expected one of "
        f"{INLINE_PREFIX!r}, {CSV_PREFIX!r}, {PARQUET_PREFIX!r}, {ROWS_PREFIX!r}"
    )


_LOCAL_PATH_REJECTED = (
    "dataRef scheme {scheme!r} is rejected: local-path schemes are disabled "
    "(DISCOVERY_SIDECAR_ALLOW_LOCAL_PATHS=false). In production the sidecar "
    "shares no data volume — send inline:// or rows:// instead."
)


def _enforce_byte_cap(body: str, max_bytes: int | None) -> None:
    if max_bytes is None:
        return
    # `len(body)` counts characters; the wire size is the UTF-8 byte count.
    size = len(body.encode("utf-8"))
    if size > max_bytes:
        raise DataRefError(
            f"dataRef payload is {size} bytes, exceeds max_bytes={max_bytes}"
        )


def _enforce_cap(df: pd.DataFrame, max_rows: int) -> pd.DataFrame:
    if len(df) > max_rows:
        raise DataRefError(
            f"dataRef contains {len(df)} rows, exceeds max_rows={max_rows}"
        )
    return df


def _load_inline_csv(body: str, max_rows: int) -> pd.DataFrame:
    # Try base64 first (the documented happy path); fall back to raw
    # CSV text so tests can send unencoded payloads.
    text: str
    try:
        text = base64.b64decode(body, validate=True).decode("utf-8")
    except Exception:  # noqa: BLE001
        text = body
    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as exc:  # noqa: BLE001
        raise DataRefError(f"failed to parse inline CSV: {exc}") from exc
    return _enforce_cap(df, max_rows)


def _load_inline_rows(body: str, max_rows: int) -> pd.DataFrame:
    try:
        rows = json.loads(body)
    except json.JSONDecodeError as exc:
        raise DataRefError(f"rows:// body is not valid JSON: {exc}") from exc
    if not isinstance(rows, list):
        raise DataRefError("rows:// body must be a JSON array")
    if not rows:
        raise DataRefError("rows:// body must contain at least one row")
    df = pd.DataFrame(rows)
    return _enforce_cap(df, max_rows)


def _load_csv_file(path: str, max_rows: int) -> pd.DataFrame:
    if not os.path.isabs(path):
        raise DataRefError(f"csv:// path must be absolute, got {path!r}")
    if not os.path.exists(path):
        raise DataRefError(f"csv:// file not found: {path}")
    try:
        df = pd.read_csv(path)
    except Exception as exc:  # noqa: BLE001
        raise DataRefError(f"failed to read csv:// file: {exc}") from exc
    return _enforce_cap(df, max_rows)


def _load_parquet_file(path: str, max_rows: int) -> pd.DataFrame:
    if not os.path.isabs(path):
        raise DataRefError(f"parquet:// path must be absolute, got {path!r}")
    if not os.path.exists(path):
        raise DataRefError(f"parquet:// file not found: {path}")
    try:
        df = pd.read_parquet(path)
    except Exception as exc:  # noqa: BLE001
        raise DataRefError(f"failed to read parquet:// file: {exc}") from exc
    return _enforce_cap(df, max_rows)
