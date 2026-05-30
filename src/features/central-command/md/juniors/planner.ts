/**
 * MD ↔ junior planner.
 *
 * Given the operator's chat text plus an attachment (CSV blob, file
 * name, MIME type) and the registered juniors, decide which junior
 * (if any) should handle it. Returns a `JuniorSpawnProposal` the MD
 * orchestrator can confirm-and-execute via the JuniorExecutor.
 *
 * Heuristic-first: deterministic keyword routing keeps the planner
 * hermetic, testable, and free of LLM costs for the 80% case. A
 * future iteration can replace `proposeJuniorSpawn` with an LLM call
 * without changing the call site — the function shape is stable.
 *
 * @module features/central-command/md/juniors/planner
 */

import type { TableKey } from "../schema-registry/types";

import type { JuniorRegistry } from "./registry";
import type { MdJuniorPort } from "./types";

// ---------------------------------------------------------------------------
// Public input / output
// ---------------------------------------------------------------------------

export interface JuniorPlannerInput {
  /** The operator's chat text for this turn. */
  readonly text: string;
  /** Optional attachment metadata (size, name, MIME) — controls routing. */
  readonly attachment?: {
    readonly filename?: string;
    readonly mimeType?: string;
    readonly bytes?: number;
  };
  /** Optional explicit tableKey hint (e.g. set when the operator clicks
   *  "Upload" on the Employees tab). When provided, this dominates the
   *  heuristic. */
  readonly tableKeyHint?: TableKey;
  /** Optional raw CSV text — when present, we route to a CSV junior. */
  readonly csv?: string;
}

export interface JuniorSpawnProposal {
  readonly junior: MdJuniorPort;
  readonly tableKey: TableKey;
  readonly reason: string;
  /** Confidence in (0, 1]. The orchestrator may apply a min-threshold
   *  before auto-spawning vs. asking the operator for confirmation. */
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Keyword → tableKey map. Every entry is lower-cased ASCII; the
// matcher is whole-word so "lead" doesn't trigger on "leadership".
//
// M-5: regexes are pre-compiled at module load so the hot loop in
// `proposeJuniorSpawn` doesn't pay 60+ `new RegExp` per call.
// ---------------------------------------------------------------------------

interface KeywordEntry {
  readonly keywords: ReadonlyArray<string>;
  readonly tableKey: TableKey;
  /** Precompiled regex per keyword, whole-word, case-insensitive. */
  readonly regexes: ReadonlyArray<RegExp>;
}

function compileKeywordEntry(
  keywords: ReadonlyArray<string>,
  tableKey: TableKey,
): KeywordEntry {
  const regexes = keywords.map((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\b|\\W)${escaped}(\\W|\\b|$)`, "i");
  });
  return Object.freeze({
    keywords,
    tableKey,
    regexes: Object.freeze(regexes),
  });
}

const KEYWORD_TABLE_MAP: ReadonlyArray<KeywordEntry> = Object.freeze(
  (
    [
      [
        "employees",
        [
          "employee",
          "employees",
          "staff",
          "hr",
          "headcount",
          "team member",
          "team members",
          "people",
        ],
      ],
      [
        "customers",
        ["customer", "customers", "client", "clients", "account", "accounts"],
      ],
      [
        "suppliers",
        ["supplier", "suppliers", "vendor", "vendors", "procurement"],
      ],
      [
        "inventory",
        ["inventory", "stock", "warehouse", "sku", "skus", "parts"],
      ],
      [
        "finance",
        [
          "finance",
          "ledger",
          "transactions",
          "invoice",
          "invoices",
          "expenses",
          "revenue",
          "p&l",
          "cashflow",
        ],
      ],
      [
        "leads",
        [
          "lead",
          "leads",
          "pipeline",
          "prospect",
          "prospects",
          "opportunity",
          "opportunities",
        ],
      ],
      [
        "products",
        ["product", "products", "catalogue", "catalog", "pricing list"],
      ],
      [
        "compliance",
        [
          "compliance",
          "regulation",
          "audit",
          "control",
          "controls",
          "kyc",
          "aml",
        ],
      ],
    ] as ReadonlyArray<[TableKey, ReadonlyArray<string>]>
  ).map(([tableKey, keywords]) => compileKeywordEntry(keywords, tableKey)),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const UPLOAD_VERBS: ReadonlyArray<string> = Object.freeze([
  "upload",
  "ingest",
  "import",
  "load",
  "attach",
  "process",
  "parse",
]);
// M-5: single precompiled regex for the verb gate.
const UPLOAD_VERB_RE = new RegExp(`\\b(?:${UPLOAD_VERBS.join("|")})\\b`, "i");
const CSV_MIME_HINTS: ReadonlySet<string> = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

/**
 * Decide whether to spawn a junior, and if so, which one.
 *
 * Returns `null` when the input doesn't look like a junior-eligible
 * request (no CSV, no upload verb, no table hint). The orchestrator
 * then falls through to the normal MD turn.
 */
export function proposeJuniorSpawn(
  input: JuniorPlannerInput,
  registry: JuniorRegistry,
): JuniorSpawnProposal | null {
  // 1. Explicit hint wins.
  if (input.tableKeyHint) {
    const junior = findCsvJuniorByTableKey(registry, input.tableKeyHint);
    if (!junior) return null;
    return Object.freeze({
      junior,
      tableKey: input.tableKeyHint,
      reason: `explicit tableKey="${input.tableKeyHint}" provided by caller`,
      confidence: 0.95,
    });
  }

  const hasCsv = typeof input.csv === "string" && input.csv.trim().length > 0;
  const looksLikeCsvAttachment =
    !!input.attachment &&
    (input.attachment.mimeType
      ? CSV_MIME_HINTS.has(input.attachment.mimeType.toLowerCase())
      : (input.attachment.filename ?? "").toLowerCase().endsWith(".csv"));

  // 2. Pure-keyword routing without a CSV: not a junior request.
  if (!hasCsv && !looksLikeCsvAttachment) return null;

  // 3. Match text → tableKey heuristically. M-5: use precompiled
  // regexes per keyword to avoid per-call `new RegExp` cost.
  const lower = input.text.toLowerCase();
  const verbHits = UPLOAD_VERB_RE.test(lower);
  let bestTableKey: TableKey | null = null;
  let bestScore = 0;
  for (const entry of KEYWORD_TABLE_MAP) {
    let score = 0;
    for (let i = 0; i < entry.regexes.length; i += 1) {
      if (entry.regexes[i]!.test(lower)) {
        const k = entry.keywords[i]!;
        score += k.split(" ").length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTableKey = entry.tableKey;
    }
  }
  // 4. Filename fallback — "employees-2026-05.csv" → employees.
  if (!bestTableKey && input.attachment?.filename) {
    bestTableKey = inferTableFromFilename(input.attachment.filename);
  }
  if (!bestTableKey) return null;

  const junior = findCsvJuniorByTableKey(registry, bestTableKey);
  if (!junior) return null;

  const confidence = computeConfidence({
    verbHits,
    hasCsv,
    looksLikeCsvAttachment,
    bestScore,
  });
  const reason = describeReason({
    tableKey: bestTableKey,
    bestScore,
    verbHits,
    hasCsv,
    looksLikeCsvAttachment,
  });
  return Object.freeze({ junior, tableKey: bestTableKey, reason, confidence });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// wholeWord helper removed: all call sites now use precompiled regexes
// (see compileKeywordEntry above). Removed to avoid drift.

function findCsvJuniorByTableKey(
  registry: JuniorRegistry,
  tableKey: TableKey,
): MdJuniorPort | undefined {
  for (const j of registry.list()) {
    if (j.guardrails.allowedTables.includes(tableKey)) return j;
  }
  return undefined;
}

function inferTableFromFilename(filename: string): TableKey | null {
  const lower = filename.toLowerCase();
  for (const entry of KEYWORD_TABLE_MAP) {
    for (const k of entry.keywords) {
      if (lower.includes(k.replace(/\s+/g, "_"))) return entry.tableKey;
      if (lower.includes(k.split(" ")[0]!)) return entry.tableKey;
    }
  }
  return null;
}

interface ConfidenceInput {
  readonly verbHits: boolean;
  readonly hasCsv: boolean;
  readonly looksLikeCsvAttachment: boolean;
  readonly bestScore: number;
}
function computeConfidence({
  verbHits,
  hasCsv,
  looksLikeCsvAttachment,
  bestScore,
}: ConfidenceInput): number {
  let c = 0.4 + 0.1 * Math.min(3, bestScore);
  if (verbHits) c += 0.1;
  if (hasCsv) c += 0.2;
  if (looksLikeCsvAttachment) c += 0.1;
  return Math.min(0.95, Math.max(0.4, Number(c.toFixed(2))));
}

interface ReasonInput {
  readonly tableKey: TableKey;
  readonly bestScore: number;
  readonly verbHits: boolean;
  readonly hasCsv: boolean;
  readonly looksLikeCsvAttachment: boolean;
}
function describeReason({
  tableKey,
  bestScore,
  verbHits,
  hasCsv,
  looksLikeCsvAttachment,
}: ReasonInput): string {
  const parts: string[] = [`matched ${tableKey} (score=${bestScore})`];
  if (verbHits) parts.push("upload-verb present");
  if (hasCsv) parts.push("raw CSV payload");
  if (looksLikeCsvAttachment) parts.push("CSV attachment detected");
  return parts.join("; ");
}
