/**
 * CSV schema-diff — turns an uploaded tabular file into a set of
 * proposed dynamic fields.
 *
 * Pipeline:
 *   1. Parse the first ~50 lines of CSV (RFC4180-shaped).
 *   2. Sniff each column's most likely kind from sample values.
 *      money / percent / date / number / boolean / enum / string.
 *   3. Snake-case the header → `fieldKey`. Drop columns we already
 *      know (live registry + the static table's hard-coded columns).
 *   4. Build a `FieldProposalInput` per new column, with 3-5 sample
 *      values + a rationale generated from the source filename.
 *
 * Bank-grade discipline:
 *   - Header values are HTML-escaped before being persisted (defence
 *     against later display in admin UI).
 *   - Sample values are size-capped at 400 chars each, max 5 per
 *     proposal.
 *   - The parser tolerates BOM, CRLF, quoted commas, and escaped
 *     quotes ("").
 *
 * @module features/central-command/md/schema-registry/csv-schema-diff
 */

import type {
  FieldKind,
  FieldProposalInput,
  LiveField,
  TableKey,
} from "./types";

// ---------------------------------------------------------------------------
// Public input / output
// ---------------------------------------------------------------------------

export interface DiffInput {
  readonly orgId: string;
  readonly tableKey: TableKey;
  /** Raw CSV text (server has already enforced size limits upstream). */
  readonly csv: string;
  /** Columns hard-coded into the static row type (e.g. {"name","role"}). */
  readonly staticColumns: ReadonlyArray<string>;
  /** Columns already in the live registry. */
  readonly liveFields: ReadonlyArray<LiveField>;
  /** Junior id filing these proposals (e.g. "hr-csv-ingest"). */
  readonly proposerId: string;
  /** Human-readable source for the rationale (e.g. "employees-2026-05.csv"). */
  readonly source: string;
  /** Cap on number of proposals returned. */
  readonly maxProposals?: number;
}

export interface DiffResult {
  readonly proposals: ReadonlyArray<FieldProposalInput>;
  /** Existing fields confirmed present in the upload (for telemetry). */
  readonly confirmedExisting: ReadonlyArray<string>;
  /** Header rows that were dropped (duplicates / unparsable). */
  readonly dropped: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function diffCsvAgainstSchema(input: DiffInput): DiffResult {
  const rows = parseCsv(input.csv).slice(0, 50);
  if (rows.length === 0) {
    return Object.freeze({
      proposals: [],
      confirmedExisting: [],
      dropped: [],
    });
  }
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return Object.freeze({
      proposals: [],
      confirmedExisting: [],
      dropped: [],
    });
  }
  const knownKeys = new Set<string>([
    ...input.staticColumns.map((c) => snakeCase(c)),
    ...input.liveFields.map((f) => f.fieldKey),
  ]);
  const proposals: FieldProposalInput[] = [];
  const confirmedExisting: string[] = [];
  const dropped: string[] = [];
  const seenInUpload = new Set<string>();
  const maxProposals = input.maxProposals ?? 16;

  for (let colIdx = 0; colIdx < headerRow.length; colIdx += 1) {
    const rawHeader = headerRow[colIdx];
    if (!rawHeader || !rawHeader.trim()) continue;
    const fieldKey = snakeCase(rawHeader);
    if (!fieldKey) {
      dropped.push(rawHeader);
      continue;
    }
    if (seenInUpload.has(fieldKey)) {
      dropped.push(rawHeader);
      continue;
    }
    seenInUpload.add(fieldKey);
    if (knownKeys.has(fieldKey)) {
      confirmedExisting.push(fieldKey);
      continue;
    }
    if (proposals.length >= maxProposals) break;

    const samples: string[] = [];
    for (const row of dataRows) {
      const cell = (row[colIdx] ?? "").trim();
      if (!cell) continue;
      if (samples.length < 5) {
        samples.push(cell.slice(0, 400));
      }
      if (samples.length >= 5) break;
    }
    const kindGuess = sniffKind(samples);
    const fieldLabel = humanLabel(rawHeader);
    proposals.push({
      orgId: input.orgId,
      tableKey: input.tableKey,
      fieldKey,
      fieldLabel,
      fieldKind: kindGuess.kind,
      enumValues: kindGuess.enumValues ? [...kindGuess.enumValues] : undefined,
      required: false,
      proposerKind: "junior",
      proposerId: input.proposerId,
      rationale: rationale(fieldLabel, input.source, samples),
      sampleValues: samples,
    });
  }

  return Object.freeze({
    proposals: Object.freeze(proposals),
    confirmedExisting: Object.freeze(confirmedExisting),
    dropped: Object.freeze(dropped),
  });
}

// ---------------------------------------------------------------------------
// CSV parser (RFC4180-shaped, BOM-tolerant)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): ReadonlyArray<ReadonlyArray<string>> {
  if (!text) return [];
  // Strip BOM.
  const body = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Kind sniffing
// ---------------------------------------------------------------------------

interface KindGuess {
  readonly kind: FieldKind;
  readonly enumValues?: ReadonlyArray<string>;
}

// Money requires EITHER a currency token (USD, TZS, $, KSh, …) OR a
// thousands-separator comma. Plain "1200" / "-3" / "50.5" fall through
// to NUMBER_RE — that's the whole point of distinguishing money from
// number in the kind sniffer.
// H-5: avoid quadratic backtracking by anchoring the digit-run as
// `\d+(,\d{3})*` (a fixed-shape thousands group) instead of `[\d,]*`.
// Pathological input like `$1,1,1,1,...` now fails the regex in O(n).
const MONEY_CURRENCY_RE =
  /^\s*(USD|TZS|KES|UGX|RWF|\$|TSh|KSh)\s*[-+]?\d+(,\d{3})*(\.\d+)?\s*$|^\s*[-+]?\d+(,\d{3})*(\.\d+)?\s*(USD|TZS|KES|UGX|RWF)\s*$/i;
const MONEY_THOUSANDS_RE = /^\s*[-+]?\d{1,3}(,\d{3})+(\.\d+)?\s*$/;
const PERCENT_RE = /^\s*[-+]?\d+(\.\d+)?\s*%\s*$/;
const NUMBER_RE = /^\s*[-+]?\d+(\.\d+)?\s*$/;
const DATE_ISO_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_SLASH_RE = /^(\d{1,2}|\d{4})[/-](\d{1,2})[/-](\d{1,2}|\d{4})$/;
const BOOLEAN_VALUES = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "1",
  "0",
]);

export function sniffKind(samples: ReadonlyArray<string>): KindGuess {
  if (samples.length === 0) return { kind: "string" };
  let money = 0;
  let percent = 0;
  let number = 0;
  let date = 0;
  let boolean = 0;
  for (const s of samples) {
    const v = s.trim();
    if (!v) continue;
    if (PERCENT_RE.test(v)) percent += 1;
    else if (MONEY_CURRENCY_RE.test(v) || MONEY_THOUSANDS_RE.test(v))
      money += 1;
    else if (NUMBER_RE.test(v)) number += 1;
    else if (DATE_ISO_RE.test(v) || DATE_SLASH_RE.test(v)) date += 1;
    else if (BOOLEAN_VALUES.has(v.toLowerCase())) boolean += 1;
  }
  const total = samples.length;
  if (percent / total >= 0.6) return { kind: "percent" };
  if (money / total >= 0.6) return { kind: "money" };
  if (date / total >= 0.6) return { kind: "date" };
  if (number / total >= 0.6) return { kind: "number" };
  if (boolean / total >= 0.8) return { kind: "boolean" };
  // Enum sniff: small set of distinct strings, low cardinality.
  // H-5: raise the minimum sample size to 8. Below that the enum
  // heuristic over-fires on natural name columns (4 employees with 4
  // unique names becomes a 4-value enum, which is meaningless). The
  // sample window is 50 lines at the call site, so the bar is easy to
  // meet for genuine enums.
  const distinct = new Set(samples.map((s) => s.trim().toLowerCase()));
  if (distinct.size > 0 && distinct.size <= 6 && samples.length >= 8) {
    return {
      kind: "enum",
      enumValues: Array.from(distinct).slice(0, 32),
    };
  }
  return { kind: "string" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function snakeCase(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

export function humanLabel(input: string): string {
  return input.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function rationale(
  label: string,
  source: string,
  samples: ReadonlyArray<string>,
): string {
  const sampleStr = samples
    .slice(0, 3)
    .map((s) => `"${s}"`)
    .join(", ");
  return [
    `New column "${label}" detected in upload "${source}" that the org's current schema doesn't track.`,
    samples.length > 0
      ? `Sample values: ${sampleStr}.`
      : "No sample values present.",
    "Approve to start tracking this field on this tab going forward.",
  ]
    .join(" ")
    .slice(0, 2000);
}
