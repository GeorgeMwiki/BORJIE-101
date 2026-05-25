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


def load_dataframe(data_ref: str, max_rows: int) -> pd.DataFrame:
    """Resolve a `dataRef` into a pandas DataFrame.

    Args:
        data_ref: One of the supported scheme prefixes above.
        max_rows: Hard cap on rows — protects the sidecar from OOM.

    Raises:
        DataRefError: On any malformed input or missing file.
    """
    if not isinstance(data_ref, str) or not data_ref:
        raise DataRefError("dataRef must be a non-empty string")

    if data_ref.startswith(INLINE_PREFIX):
        body = data_ref[len(INLINE_PREFIX) :]
        return _load_inline_csv(body, max_rows)

    if data_ref.startswith(CSV_PREFIX):
        path = data_ref[len(CSV_PREFIX) :]
        return _load_csv_file(path, max_rows)

    if data_ref.startswith(PARQUET_PREFIX):
        path = data_ref[len(PARQUET_PREFIX) :]
        return _load_parquet_file(path, max_rows)

    if data_ref.startswith(ROWS_PREFIX):
        body = data_ref[len(ROWS_PREFIX) :]
        return _load_inline_rows(body, max_rows)

    raise DataRefError(
        f"dataRef scheme not recognised; expected one of "
        f"{INLINE_PREFIX!r}, {CSV_PREFIX!r}, {PARQUET_PREFIX!r}, {ROWS_PREFIX!r}"
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
