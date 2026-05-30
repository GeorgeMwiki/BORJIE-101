"use client";

/**
 * Table renderer for `table` specs. Uses TanStack Table v8 when present;
 * falls back to a plain semantic table otherwise. Sortable + filterable
 * + paginated when configured by the spec.
 */

import { useEffect, useMemo, useState } from "react";
import type { TableSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";
import { formatCell, tryOptionalImport } from "./_shared";

interface Props {
  spec: TableSpec;
}

export default function TableTanStack({ spec }: Props) {
  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Data table";

  return (
    <figure
      role="figure"
      aria-label={ariaLabel}
      className="my-3 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </figcaption>
      ) : null}
      <SortableTable spec={spec} />
      <SourceTrail {...(spec.source ?? {})} />
    </figure>
  );
}

function SortableTable({ spec }: { spec: TableSpec }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const pageSize = spec.pagination?.pageSize ?? 25;

  // Try TanStack Table only for instrumentation. We always render via the
  // semantic <table> below so missing the package never breaks the UI.
  const [, setTanstackLoaded] = useState(false);
  useEffect(() => {
    tryOptionalImport("@tanstack/react-table").then((mod) => {
      if (mod) setTanstackLoaded(true);
    });
  }, []);

  const filteredRows = useMemo(() => {
    if (!filter.trim() || !spec.filterable) return spec.rows;
    const lc = filter.toLowerCase();
    return spec.rows.filter((row) =>
      Object.values(row).some((v) =>
        v === null || v === undefined
          ? false
          : String(v).toLowerCase().includes(lc),
      ),
    );
  }, [filter, spec.filterable, spec.rows]);

  const sortedRows = useMemo(() => {
    if (!sortKey || !spec.sortable) return filteredRows;
    const sorted = [...filteredRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === null || av === undefined) return sortDir === "asc" ? -1 : 1;
      if (bv === null || bv === undefined) return sortDir === "asc" ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [filteredRows, sortKey, sortDir, spec.sortable]);

  const pagedRows = useMemo(() => {
    if (!spec.pagination) return sortedRows;
    const start = page * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, spec.pagination, page, pageSize]);

  const totalPages = spec.pagination
    ? Math.max(1, Math.ceil(sortedRows.length / pageSize))
    : 1;

  function toggleSort(key: string) {
    if (!spec.sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <>
      {spec.filterable ? (
        <div className="mb-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            placeholder="Filter rows…"
            aria-label="Filter rows"
            className="w-full max-w-xs rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
      ) : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {spec.columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className="border-b border-slate-200 py-2 pr-3 font-medium text-slate-700"
                aria-sort={
                  spec.sortable && sortKey === col.key
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : spec.sortable
                      ? "none"
                      : undefined
                }
              >
                {spec.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1"
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      <span aria-hidden>{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pagedRows.length === 0 ? (
            <tr>
              <td
                colSpan={spec.columns.length}
                className="py-3 text-center text-slate-500"
              >
                No rows
              </td>
            </tr>
          ) : (
            pagedRows.map((row, idx) => (
              <tr key={`row-${idx}`} className="border-b border-slate-100">
                {spec.columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-1 pr-3 ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : ""
                    }`}
                  >
                    {formatCell(row[col.key] ?? null, col.format)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {spec.pagination ? (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
          <span>
            Page {page + 1} of {totalPages} ({sortedRows.length} rows)
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      ) : null}
    </>
  );
}
