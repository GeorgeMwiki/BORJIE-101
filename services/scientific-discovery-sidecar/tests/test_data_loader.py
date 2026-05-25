"""Unit tests for the dataRef resolver. These do NOT need DoWhy / Tigramite."""

from __future__ import annotations

import base64
import json
import os
import tempfile

import pytest

from app.services.data_loader import DataRefError, load_dataframe


def test_rows_scheme_round_trip() -> None:
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
    df = load_dataframe("rows://" + json.dumps(rows), max_rows=100)
    assert list(df.columns) == ["a", "b"]
    assert df.iloc[0]["a"] == 1
    assert df.iloc[1]["b"] == 4


def test_rows_scheme_rejects_non_array() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("rows://" + json.dumps({"not": "an array"}), max_rows=100)


def test_rows_scheme_rejects_empty_array() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("rows://[]", max_rows=100)


def test_rows_scheme_rejects_bad_json() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("rows://{not-json", max_rows=100)


def test_inline_csv_plain_text() -> None:
    csv = "a,b\n1,2\n3,4\n"
    df = load_dataframe("inline://" + csv, max_rows=100)
    assert list(df.columns) == ["a", "b"]
    assert len(df) == 2


def test_inline_csv_base64() -> None:
    csv = "a,b\n1,2\n3,4\n"
    b64 = base64.b64encode(csv.encode()).decode()
    df = load_dataframe("inline://" + b64, max_rows=100)
    assert list(df.columns) == ["a", "b"]
    assert len(df) == 2


def test_csv_file_scheme() -> None:
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    ) as f:
        f.write("a,b\n1,2\n3,4\n")
        path = f.name
    try:
        df = load_dataframe(f"csv://{path}", max_rows=100)
        assert len(df) == 2
    finally:
        os.unlink(path)


def test_csv_file_scheme_requires_absolute_path() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("csv://relative/path.csv", max_rows=100)


def test_csv_file_scheme_missing_file() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("csv:///nonexistent/file-xyz-123.csv", max_rows=100)


def test_unknown_scheme_rejected() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("ftp://server/file.csv", max_rows=100)


def test_empty_string_rejected() -> None:
    with pytest.raises(DataRefError):
        load_dataframe("", max_rows=100)


def test_row_cap_enforced() -> None:
    rows = [{"a": i} for i in range(200)]
    with pytest.raises(DataRefError):
        load_dataframe("rows://" + json.dumps(rows), max_rows=100)
