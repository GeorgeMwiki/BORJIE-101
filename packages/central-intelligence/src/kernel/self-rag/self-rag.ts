/**
 * Self-RAG — per-turn reflection token emitter.
 *
 * Per Asai et al. (ICLR 2024, arXiv 2310.11511) Self-RAG produces three
 * categorical reflection tokens on each turn:
 *
 *   - IsREL  (relevance)   — does the retrieved evidence relate to the
 *                            user's question?
 *   - IsSUP  (support)     — is each claim in the response actually
 *                            supported by retrieved context / memory?
 *   - IsUSE  (usefulness)  — does the response solve the user's task?
 *
 * BORJIE policy (per `2025-progressive-intelligence.md` §5):
 *   Zero-tolerance for hallucinated rent numbers / unit IDs / lease
 *   terms — IsSUP MUST be enforced on any financial or contractual
 *   claim. The kernel calls `enforceSelfRag(...)` after the sensor's
 *   response and before the policy gate; when the verdict blocks, the
 *   kernel emits a `RUN_ERROR` refusal instead of returning the answer.
 *
 * The judge model is the SAME Haiku-backed judge port the kernel
 * already wires for `req.requireJudge` (so we don't introduce a new
 * provider dependency). The output is parsed into the three categorical
 * tokens — the judge can return JSON or a free-text "REL=high SUP=...
 * USE=..." form; both shapes are accepted.
 */

export type SelfRagToken = 'high' | 'partial' | 'low' | 'unknown';

export interface SelfRagVerdict {
  readonly isRel: SelfRagToken;
  readonly isSup: SelfRagToken;
  readonly isUse: SelfRagToken;
  /** Why the verdict was reached. Surfaced in traces + audit. */
  readonly rationale: string;
  /**
   * Whether the response should be blocked under the project policy.
   * True when:
   *   - the response contains financial / contractual claims AND
   *   - IsSUP is 'low' or 'unknown'.
   * The kernel maps `blocked=true` to a refusal with reason
   * `'self-rag/insufficient-support'`.
   */
  readonly blocked: boolean;
  /** A reason string for logging when blocked. */
  readonly blockedReason?: string;
}

export interface SelfRagJudge {
  (text: string): Promise<{
    readonly score: number;
    readonly reasonText?: string;
    readonly suggestedFix?: string;
  }>;
}

/**
 * Hybrid-retrieval fallback config. When `retrievedContext` is empty
 * AND a `hybridRetrieval` bundle is wired, `runSelfRag` will call
 * `buildRetrievedContext` to materialise the context just-in-time
 * from the persistent memory layer (migration 0181). The bundle is
 * fully optional; omitting it keeps the legacy behaviour.
 */
export interface SelfRagHybridRetrieval {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly embedder: (text: string) => Promise<ReadonlyArray<number>>;
  /** Duck-typed `HybridRetrievalRepo` — kept loose to avoid an import cycle. */
  readonly repo: {
    searchBm25(args: {
      readonly tenantId: string;
      readonly sessionId: string;
      readonly query: string;
      readonly limit: number;
    }): Promise<ReadonlyArray<{ readonly id: string; readonly text: string }>>;
    searchVector(args: {
      readonly tenantId: string;
      readonly sessionId: string;
      readonly embedding: ReadonlyArray<number>;
      readonly limit: number;
    }): Promise<ReadonlyArray<{ readonly id: string; readonly text: string }>>;
  };
  /** Override the top-N returned by the fusion. Default 8. */
  readonly topN?: number;
}

export interface SelfRagInput {
  readonly userMessage: string;
  readonly responseText: string;
  /** Optional context bundle the kernel retrieved + injected. */
  readonly retrievedContext?: ReadonlyArray<string>;
  /**
   * Optional hybrid-retrieval bundle. When supplied AND
   * `retrievedContext` is missing or empty, the critic materialises
   * the context from the persistent memory layer (migration 0181) so
   * the judge always has something concrete to score against.
   */
  readonly hybridRetrieval?: SelfRagHybridRetrieval;
  /** Haiku-backed judge wrapping the LLM critic. Required. */
  readonly judge: SelfRagJudge;
  /**
   * Optional stakes — EP-3 CRITICAL #3 fail-closed policy. When the
   * judge throws AND stakes ∈ {high, critical} AND env is NOT
   * dev/test, the verdict returns blocked=true with reason
   * 'judge_unavailable' so a flaky Haiku session does NOT silently
   * let a high-stakes turn through ungraded. Dev/test keeps the
   * previous fail-open behaviour so flaky local runs don't blank
   * the product.
   */
  readonly stakes?: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Optional env override — defaults to `process.env.NODE_ENV`. Tests
   * inject 'test' to keep the fail-open branch even when stakes are
   * high; the production composition root leaves it undefined so the
   * real NODE_ENV is read.
   */
  readonly nodeEnv?: string;
  /** Optional clock for tests. */
  readonly now?: () => number;
}

/**
 * Detect financial / contractual / regulatory claims in the response
 * text. The kernel blocks the answer when IsSUP < 'high' and one of
 * these patterns is present.
 *
 * Conservative regexes — we'd rather over-trigger and force grounding
 * than let an unsupported rent number through. The detector matches:
 *
 *   - currency amounts ("TZS 450,000", "KES 12,000", "$1,200")
 *   - "rent of …" / "deposit of …" / "fee of …" + a number
 *   - lease / contract / clause references with a section number
 *   - explicit policy statements ("according to the lease …")
 */
const FINANCIAL_REGEXES: ReadonlyArray<RegExp> = [
  // ISO-4217 + common informal labels. Kept in sync with policy-gate's
  // ABSOLUTE_MONEY_PATTERN and ai-copilot's MONETARY_PATTERNS.
  /\b(?:TZS|KES|UGX|RWF|NGN|ZAR|GHS|EGP|USD|EUR|GBP|CHF|JPY|CNY|INR|AUD|CAD|Ksh|KShs|Tsh|TShs|Sh|Shs)\s*[\d,]+(?:\.\d+)?/i,
  /\$\s*\d[\d,]*(?:\.\d+)?/,
  /\b(?:rent|deposit|fee|fine|penalty|surcharge|payment)\s+of\s+[\d,]+/i,
  /\b(?:lease|contract)\s+(?:clause|section|article)\s+[\d.]+/i,
  /\baccording to (?:the )?(?:lease|contract|tenancy agreement)/i,
  /\b(?:tenant|owner|landlord)\s+(?:must|shall|is required to)\s+pay/i,
];

export function containsFinancialClaim(text: string): boolean {
  if (!text) return false;
  for (const rx of FINANCIAL_REGEXES) {
    if (rx.test(text)) return true;
  }
  return false;
}

/**
 * Run a Self-RAG reflection over the kernel's draft response and decide
 * whether to block it. The judge port runs the LLM critic; we parse its
 * output into the three categorical tokens.
 *
 * The judge prompt is intentionally embedded here (not in a separate
 * file) because Self-RAG's critique format is part of the algorithm's
 * specification — splitting it out would invite drift.
 */
export async function runSelfRag(
  input: SelfRagInput,
): Promise<SelfRagVerdict> {
  if (typeof input.judge !== 'function') {
    return {
      isRel: 'unknown',
      isSup: 'unknown',
      isUse: 'unknown',
      rationale: 'no judge wired',
      blocked: false,
    };
  }

  // Hybrid-retrieval fallback. When the caller did not pre-populate
  // `retrievedContext` (or supplied an empty array) AND a
  // `hybridRetrieval` bundle is wired, materialise the context from
  // the persistent memory layer (migration 0181). Fail-soft: any
  // throw inside the fallback is swallowed so the judge still runs
  // (with no retrieved context) — exactly the legacy behaviour.
  const ctxFromInput = input.retrievedContext ?? [];
  let resolvedContext: ReadonlyArray<string> = ctxFromInput;
  if (ctxFromInput.length === 0 && input.hybridRetrieval) {
    resolvedContext = await materialiseHybridContext(input);
  }
  const probeInput: SelfRagInput =
    resolvedContext === ctxFromInput
      ? input
      : { ...input, retrievedContext: resolvedContext };

  const probe = buildJudgeProbe(probeInput);
  let judgeOut: { score: number; reasonText?: string; suggestedFix?: string };
  try {
    judgeOut = await input.judge(probe);
  } catch (err) {
    // EP-3 CRITICAL #3 — fail-closed policy. In production, when the
    // judge throws AND stakes ∈ {high, critical}, the Self-RAG critic
    // is the LAST line of defence against ungrounded financial /
    // contractual claims. Letting the turn through ungraded would
    // mean a flaky Haiku session bypasses the grounding gate for the
    // turns that need it most. So:
    //
    //   - prod   + stakes∈{high,critical}  → blocked=true (fail closed)
    //   - prod   + stakes∈{low,medium}     → fail open (legacy)
    //   - dev/test                          → fail open (don't blank
    //                                         the product on flaky
    //                                         local runs)
    const nodeEnv = (input.nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
    const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'dev' ||
      nodeEnv === 'test' || nodeEnv === 'testing' || nodeEnv === '';
    const isHighStakes = input.stakes === 'high' || input.stakes === 'critical';
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!isDevOrTest && isHighStakes) {
      return {
        isRel: 'unknown',
        isSup: 'unknown',
        isUse: 'unknown',
        rationale: `judge-error: ${errMsg}`,
        blocked: true,
        blockedReason: 'judge_unavailable',
      };
    }
    return {
      isRel: 'unknown',
      isSup: 'unknown',
      isUse: 'unknown',
      rationale: `judge-error: ${errMsg}`,
      blocked: false,
    };
  }

  const parsed = parseTokens(judgeOut.reasonText ?? '');
  const verdict: SelfRagVerdict = {
    isRel: parsed.isRel,
    isSup: parsed.isSup,
    isUse: parsed.isUse,
    rationale:
      (judgeOut.reasonText ?? judgeOut.suggestedFix ?? '').slice(0, 1_000) ||
      'no rationale provided',
    blocked: false,
  };

  const hasFinClaim = containsFinancialClaim(input.responseText);
  if (hasFinClaim && (verdict.isSup === 'low' || verdict.isSup === 'unknown')) {
    return {
      ...verdict,
      blocked: true,
      blockedReason: `Self-RAG IsSUP=${verdict.isSup} on a financial/contractual claim`,
    };
  }
  return verdict;
}

/**
 * Build the judge probe — a single prompt that asks for the three
 * tokens against the user message + draft response + retrieved
 * context. The prompt is concrete: it requests the literal "REL=...
 * SUP=... USE=..." line so the parser doesn't depend on a structured
 * JSON return.
 */
function buildJudgeProbe(input: SelfRagInput): string {
  const ctx = (input.retrievedContext ?? [])
    .map((c, i) => `  [${i + 1}] ${truncate(c, 400)}`)
    .join('\n');
  return [
    'You are a Self-RAG reflection critic per Asai et al. (ICLR 2024).',
    'Score the draft response against the user message and retrieved context.',
    '',
    'Reply with EXACTLY one line in this form (no JSON, no commentary):',
    'REL=<high|partial|low> SUP=<high|partial|low> USE=<high|partial|low>',
    'Then a one-sentence rationale on the next line.',
    '',
    `USER MESSAGE:`,
    truncate(input.userMessage ?? '', 1_000),
    '',
    `DRAFT RESPONSE:`,
    truncate(input.responseText ?? '', 2_000),
    '',
    'RETRIEVED CONTEXT:',
    ctx || '  (no retrieval supplied)',
  ].join('\n');
}

const TOKEN_VALUES: ReadonlySet<SelfRagToken> = new Set([
  'high',
  'partial',
  'low',
  'unknown',
]);

interface ParsedTokens {
  isRel: SelfRagToken;
  isSup: SelfRagToken;
  isUse: SelfRagToken;
}

function parseTokens(text: string): ParsedTokens {
  const out: ParsedTokens = {
    isRel: 'unknown',
    isSup: 'unknown',
    isUse: 'unknown',
  };
  if (!text) return out;
  const rxs: Array<[keyof ParsedTokens, RegExp]> = [
    ['isRel', /REL\s*=\s*(high|partial|low|unknown)/i],
    ['isSup', /SUP\s*=\s*(high|partial|low|unknown)/i],
    ['isUse', /USE\s*=\s*(high|partial|low|unknown)/i],
  ];
  for (const [key, rx] of rxs) {
    const m = rx.exec(text);
    if (m && m[1]) {
      const lower = m[1].toLowerCase() as SelfRagToken;
      if (TOKEN_VALUES.has(lower)) {
        out[key] = lower;
      }
    }
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Materialise retrieved context via the persistent memory layer's
 * hybrid retrieval (BM25 + vector with Reciprocal Rank Fusion).
 * Imported lazily so callers that never wire `hybridRetrieval` don't
 * pull the dependency into their bundle.
 *
 * Fail-soft: any throw collapses to an empty context — the judge then
 * sees "(no retrieval supplied)" and the rest of the pipeline behaves
 * exactly like the legacy path.
 */
async function materialiseHybridContext(
  input: SelfRagInput,
): Promise<ReadonlyArray<string>> {
  const bundle = input.hybridRetrieval;
  if (!bundle) return [];
  try {
    const { buildRetrievedContext } = await import(
      '../memory/hybrid-retrieval.js'
    );
    return await buildRetrievedContext(
      bundle.tenantId,
      bundle.sessionId,
      input.userMessage ?? '',
      bundle.embedder,
      // The bundle.repo shape is a duck-typed subset of HybridRetrievalRepo —
      // cast at the boundary so we don't force callers to import the
      // memory port types just to construct the input.
      bundle.repo as unknown as Parameters<typeof buildRetrievedContext>[4],
      bundle.topN ? { topN: bundle.topN } : undefined,
    );
  } catch {
    return [];
  }
}
