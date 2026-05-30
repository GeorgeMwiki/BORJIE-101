/**
 * Intent Parser — classify whether an owner chat turn is asking for
 * inline data, and which kind/subject.
 *
 * Design: deterministic rule-engine first (fast, free, testable), with
 * an optional LLM fallback for ambiguous turns. Each rule is a tuple
 * of (regex, classification) — order matters: more specific rules win.
 *
 * The rules cover the full mvp surface: "show me the team" → table,
 * "how are sales trending" → chart, "what's the org chart" → diagram,
 * "show the supplier contract" → file-preview, "what's our top
 * customer" → metric-grid, "log a new hire" → form.
 *
 * @module features/central-command/md/presenter/intent-parser
 */

import { createLogger } from "@/lib/logger";
import {
  InlineDataRequestSchema,
  type InlineDataRequest,
  type InlineDataKind,
  type InlineDataSubject,
  type OwnerStyleHint,
} from "./types";

const log = createLogger("md.presenter.intent");

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

interface IntentRule {
  readonly pattern: RegExp;
  readonly kind: InlineDataKind;
  readonly subject: InlineDataSubject;
  readonly description: string;
}

/**
 * Ordered rules. The first match wins. The patterns are intentionally
 * narrow phrases owners actually say; ambiguous turns fall through to
 * the negative-classification path and the presenter returns null.
 *
 * NOTE: every rule has a corresponding fixture in
 * `__tests__/intent-parser.test.ts`. Do NOT add a rule without a
 * fixture, or the test suite will fail to cover the surface.
 */
const RULES: ReadonlyArray<IntentRule> = Object.freeze([
  // --- Team / employees (table) ---
  {
    pattern:
      /\b(show|list|who is on|who's on|give me)\b.*\b(team|staff|employees|crew|people)\b/i,
    kind: "table",
    subject: "employees",
    description: "show the team",
  },
  {
    pattern: /\bteam\s+(roster|list|members|directory)\b/i,
    kind: "table",
    subject: "employees",
    description: "team roster",
  },

  // --- Org chart (diagram) ---
  {
    pattern:
      /\b(org\s*chart|organisation\s*chart|organization\s*chart|reporting\s*structure|who\s+reports\s+to\s+who)\b/i,
    kind: "diagram",
    subject: "org-chart",
    description: "org chart",
  },

  // --- Customers (table or top metric) ---
  {
    pattern:
      /\b(top|biggest|best|highest[- ]value)\s+(customer|client|account)s?\b/i,
    kind: "metric-grid",
    subject: "top-customer",
    description: "top customer",
  },
  {
    pattern: /\b(show|list)\b.*\bcustomers?\b/i,
    kind: "table",
    subject: "customers",
    description: "show customers",
  },

  // --- Sales / revenue (chart) ---
  {
    pattern:
      /\b(sales|revenue|gmv|turnover)\b.*\b(trend|trending|over\s+time|by\s+month|by\s+week|history)\b/i,
    kind: "chart",
    subject: "sales-trend",
    description: "sales trend chart",
  },
  {
    pattern: /\bhow\s+(are|is)\s+(sales|revenue)\b/i,
    kind: "chart",
    subject: "sales-trend",
    description: "how are sales",
  },
  {
    pattern: /\b(revenue|sales)\s+(chart|graph)\b/i,
    kind: "chart",
    subject: "revenue",
    description: "revenue chart",
  },

  // --- KPI summary (metric-grid) ---
  {
    pattern:
      /\b(kpis?|key\s+metrics|dashboard|how\s+(are|is)\s+we\s+doing|business\s+overview)\b/i,
    kind: "metric-grid",
    subject: "kpi-summary",
    description: "kpi summary",
  },

  // --- Cash (metric-grid) ---
  {
    pattern:
      /\b(cash\s+position|cash\s+on\s+hand|cash\s+balance|how\s+much\s+cash)\b/i,
    kind: "metric-grid",
    subject: "cash-position",
    description: "cash position",
  },

  // --- Expenses (chart) ---
  {
    pattern:
      /\b(expenses?|spend|costs?)\b.*\b(trend|over\s+time|breakdown|by\s+category)\b/i,
    kind: "chart",
    subject: "expenses",
    description: "expenses chart",
  },

  // --- Outstanding invoices (table) ---
  {
    pattern:
      /\b(outstanding|unpaid|overdue)\s+(invoices?|bills?|receivables?)\b/i,
    kind: "table",
    subject: "outstanding-invoices",
    description: "outstanding invoices",
  },

  // --- Pending approvals (table) ---
  {
    pattern:
      /\b(pending|outstanding|awaiting)\s+(approvals?|sign[- ]offs?|reviews?)\b/i,
    kind: "table",
    subject: "pending-approvals",
    description: "pending approvals",
  },

  // --- Supplier contract (file-preview) ---
  {
    pattern:
      /\b(show|open|view|preview|pull\s+up)\b.*\b(supplier|vendor|contract|agreement|sla)\b/i,
    kind: "file-preview",
    subject: "supplier-contract",
    description: "supplier contract",
  },
  {
    pattern: /\b(the|that|our)\s+(supplier|vendor)\s+contract\b/i,
    kind: "file-preview",
    subject: "supplier-contract",
    description: "the supplier contract",
  },

  // --- Form (capture-style asks) ---
  {
    pattern:
      /\b(log|record|add|register)\s+(a\s+)?(new\s+)?(hire|employee|customer|expense|invoice)\b/i,
    kind: "form",
    subject: "employees",
    description: "log a new hire",
  },
]);

// ---------------------------------------------------------------------------
// Owner-style inference (rough heuristic)
// ---------------------------------------------------------------------------

/**
 * Infer a style hint from the surface form of the owner's message.
 *  - terse:    1–3 words, no question mark, no auxiliaries.
 *  - verbose:  >15 words OR ends with "explain"/"walk me through".
 *  - balanced: everything else.
 *
 * The caller's explicit hint (from owner-profile) always wins; this
 * heuristic is only used when no hint is supplied.
 */
export function inferOwnerStyleHint(text: string): OwnerStyleHint {
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3 && !trimmed.includes("?")) return "terse";
  if (
    wordCount > 15 ||
    /\b(explain|walk\s+me\s+through|narrate|tell\s+me\s+about)\b/i.test(trimmed)
  ) {
    return "verbose";
  }
  return "balanced";
}

// ---------------------------------------------------------------------------
// Filter extraction
// ---------------------------------------------------------------------------

/**
 * Pull lightweight filters out of the text. We intentionally keep
 * this very narrow — the spec-builder is the source of truth for
 * which filters each subject supports.
 *
 *   - "last month"  → { window: "last_month" }
 *   - "this quarter" → { window: "this_quarter" }
 *   - "ytd" / "year to date" → { window: "ytd" }
 *   - "in engineering" → { department: "engineering" }
 */
function extractFilters(text: string): Record<string, string> {
  const filters: Record<string, string> = {};
  const lower = text.toLowerCase();

  if (/\blast\s+month\b/.test(lower)) filters.window = "last_month";
  else if (/\bthis\s+month\b/.test(lower)) filters.window = "this_month";
  else if (/\blast\s+quarter\b/.test(lower)) filters.window = "last_quarter";
  else if (/\bthis\s+quarter\b/.test(lower)) filters.window = "this_quarter";
  else if (/\b(ytd|year[- ]to[- ]date|this\s+year)\b/.test(lower))
    filters.window = "ytd";
  else if (/\blast\s+year\b/.test(lower)) filters.window = "last_year";

  const deptMatch =
    /\b(?:in|for)\s+(engineering|sales|ops|finance|hr|marketing|product)\b/i.exec(
      text,
    );
  if (deptMatch && deptMatch[1]) {
    filters.department = deptMatch[1].toLowerCase();
  }

  return filters;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseInput {
  readonly text: string;
  readonly ownerStyleHint?: OwnerStyleHint;
}

/**
 * Parse an owner turn into an `InlineDataRequest`. Returns null when
 * the turn is not requesting inline data (e.g. small-talk, a write
 * action, or an ambiguous ask).
 *
 * The classification is rule-based + deterministic. An LLM fallback
 * may be added behind a feature-flag in the future; for now the rule
 * surface covers the 90th-percentile owner asks (see test fixtures).
 *
 * The returned spec is always Zod-validated, so callers never need to
 * re-parse.
 */
export function parseOwnerIntent(input: ParseInput): InlineDataRequest | null {
  const text = input.text?.trim() ?? "";
  if (!text) return null;
  if (text.length > 2_000) {
    // Pathologically long turns are almost certainly pastes, not
    // inline-data asks. Skip cheaply.
    log.debug("intent skipped, text too long", { length: text.length });
    return null;
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      const filters = extractFilters(text);
      const candidate = {
        kind: rule.kind,
        subject: rule.subject,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        ownerStyleHint: input.ownerStyleHint ?? inferOwnerStyleHint(text),
      };
      const parsed = InlineDataRequestSchema.safeParse(candidate);
      if (!parsed.success) {
        log.warn("intent matched rule but failed schema parse", {
          rule: rule.description,
          issues: parsed.error.issues,
        });
        return null;
      }
      return parsed.data;
    }
  }

  return null;
}

/**
 * Return the catalogue of recognised intents — useful for tests and
 * tooling. Frozen at module load so callers can never mutate.
 */
export function listIntentRules(): ReadonlyArray<{
  readonly description: string;
  readonly kind: InlineDataKind;
  readonly subject: InlineDataSubject;
}> {
  return Object.freeze(
    RULES.map((r) =>
      Object.freeze({
        description: r.description,
        kind: r.kind,
        subject: r.subject,
      }),
    ),
  );
}
