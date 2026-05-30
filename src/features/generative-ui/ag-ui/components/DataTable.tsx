"use client";

/**
 * 2. data-table — sortable + filterable HTML table with CSV export.
 *
 * Anti-patterns enforced:
 *   - LLM emits column metadata only (not className or render fns)
 *   - Zod-safeParse before render
 *
 * Future migration to @tanstack/react-table v8 is a one-line factory
 * change inside this file — the AdaptiveRenderer never sees it.
 */

import { useMemo, useState } from "react";

import type { AgUiUiPartByKind, DataTableColumn } from "../types";
import { Frame, GenUiError } from "./Frame";
import { DataTablePartSchema } from "../schemas";
import { formatCell } from "../format";

export type DataTableProps = AgUiUiPartByKind<"data-table">;

type SortDir = "asc" | "desc" | null;

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  if (dir === null) return 0;
  if (a == null && b == null) return 0;
  if (a == null) return dir === "asc" ? -1 : 1;
  if (b == null) return dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") {
    return dir === "asc" ? a - b : b - a;
  }
  const sa = String(a);
  const sb = String(b);
  return dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
}

function exportCsv(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  columns: ReadonlyArray<DataTableColumn>,
): void {
  const header = columns
    .map((c) => `"${c.header.replace(/"/g, '""')}"`)
    .join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = r[c.accessorKey];
          const s = formatCell(v, c.format, c.currency);
          return `"${String(s).replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "table.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTable(props: DataTableProps): JSX.Element {
  const parsed = DataTablePartSchema.safeParse(props);

  const [sortBy, setSortBy] = useState<{ id: string; dir: SortDir } | null>(
    null,
  );
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    const col = sortBy ? props.columns.find((c) => c.id === sortBy.id) : null;
    let r = props.rows as ReadonlyArray<Record<string, unknown>>;
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter((row) =>
        props.columns.some((c) =>
          String(row[c.accessorKey] ?? "")
            .toLowerCase()
            .includes(f),
        ),
      );
    }
    if (col && sortBy && sortBy.dir) {
      const dir = sortBy.dir;
      r = [...r].sort((a, b) =>
        compareValues(a[col.accessorKey], b[col.accessorKey], dir),
      );
    }
    return r;
  }, [filter, props.columns, props.rows, sortBy]);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="data-table"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  function onHeaderClick(c: DataTableColumn): void {
    if (c.enableSorting === false) return;
    setSortBy((prev) => {
      if (!prev || prev.id !== c.id) return { id: c.id, dir: "asc" };
      if (prev.dir === "asc") return { id: c.id, dir: "desc" };
      return null;
    });
  }

  const pageSize = props.pageSize ?? 50;
  const visible = sorted.slice(0, pageSize);

  return (
    <Frame kind="data-table" {...(props.title ? { title: props.title } : {})}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => exportCsv(sorted, props.columns)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs"
        >
          CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {props.columns.map((c) => (
                <th
                  key={c.id}
                  onClick={() => onHeaderClick(c)}
                  className="cursor-pointer border-b border-border px-2 py-1 text-left font-medium"
                >
                  {c.header}
                  {sortBy?.id === c.id
                    ? sortBy.dir === "asc"
                      ? " ▲"
                      : " ▼"
                    : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-b border-border/40">
                {props.columns.map((c) => (
                  <td key={c.id} className="px-2 py-1">
                    {formatCell(row[c.accessorKey], c.format, c.currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > visible.length ? (
        <div className="mt-2 text-xs text-muted-foreground">
          showing {visible.length} of {sorted.length}
        </div>
      ) : null}
    </Frame>
  );
}
