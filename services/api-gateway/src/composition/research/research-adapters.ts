/**
 * Research tool adapters + brain-LLM plan/synthesize seams.
 *
 * The research-orchestrator engine consumes:
 *   - a `toolRegistry` (a `ReadonlyMap<ResearchTool, ToolAdapter>`) the
 *     step-runner looks up by `step.tool`; a missing key is a clean skip,
 *   - an optional `llmPlan(req)` the planner calls to turn an owner intent
 *     into a step list (else a rule-based template fires), and
 *   - an optional `llmSynthesize(req)` the synthesizer calls to render the
 *     citation-anchored markdown body (else a deterministic rule-based
 *     render fires).
 *
 * This module is the thin seam that BUILDS those three things from real,
 * already-shipped pieces — never a stub:
 *
 *   1. WEB SEARCH (`web_search`) — the real `@borjie/research-tools`
 *      Tavily adapter (SOTA agentic-search index), with the Brave adapter
 *      as a graceful fallback. Both are Tier-0 read-only, reserve budget
 *      before the call, score + bias-flag + audit-hash every artifact via
 *      the shared scorer, and return `[]` (never throw) when their API key
 *      is absent. We mark every web query `is_fast_moving_topic: true` so
 *      the scorer's 90-day recency decay applies — freshness-weighted by
 *      construction.
 *
 *   2. NEWS SCAN (`news_scan`) — the real GDELT adapter (no key required),
 *      mapped from the planner's `{ terms, window_hours }` step input to a
 *      recency-bounded GDELT `timespan` query.
 *
 *   3. CORPUS RETRIEVAL (`corpus_query`) — a real pgvector ANN retrieval
 *      over `intelligence_corpus_chunks` (the always-current ground-truth
 *      corpus, `tenant_id IS NULL` global + the caller's private chunks),
 *      RECENCY/FRESHNESS-WEIGHTED: candidates are pulled by vector distance
 *      then re-ranked by `0.85·similarity + 0.15·freshness` where freshness
 *      decays over `ingested_at`. Degrades to an ILIKE keyword path when no
 *      embedding is available, and to `[]` when no DB is wired. Each row
 *      becomes a scored, citation-id'd, audit-hashed `ResearchArtifact`.
 *
 *   4. PLAN / SYNTHESIZE — backed by the gateway's canonical single-shot
 *      brain caller (`callBrainOnce`, the Anthropic→OpenAI→DeepSeek ladder
 *      over `@borjie/brain-llm-router`'s universal-client adapters). The
 *      planner output is parsed into a strict step list; a malformed or
 *      provider-less reply throws so the orchestrator falls back to its
 *      rule-based path (the planner/synthesizer both wrap the call in a
 *      try/catch). Grounded: the synthesize prompt is handed the scored
 *      artifacts + their citation ids so the rendered answer cites them.
 *
 * Boundaries: this module reads env ONLY through the research-tools
 * adapters' own `readEnvKey` (their documented degradation seam) and the
 * shared embed/brain callers — it never reads `process.env` directly and
 * never starts a server. Pino-only logging via the injected logger.
 */

import {
  createTavilyAdapter,
  createBraveAdapter,
  createGdeltAdapter,
  buildArtifact,
  deriveArtifactId,
  type ToolAdapter as RtToolAdapter,
} from '@borjie/research-tools';

import type {
  ModeRunDeps,
  ResearchArtifact,
  ResearchTool,
  ToolAdapter,
  ToolContext,
} from '@borjie/research-orchestrator';

// `LlmPlanRequest` / `StepTemplate` / `LlmSynthesizeRequest` are NOT on the
// orchestrator's public barrel — derive the exact contracts from the
// `ModeRunDeps.llmPlan` / `llmSynthesize` optional fields (which ARE
// exported) so the seam matches the engine's expectation precisely.
type LlmPlanFn = NonNullable<ModeRunDeps['llmPlan']>;
type LlmPlanRequest = Parameters<LlmPlanFn>[0];
type StepTemplate = Awaited<ReturnType<LlmPlanFn>>[number];
type LlmSynthesizeFn = NonNullable<ModeRunDeps['llmSynthesize']>;
type LlmSynthesizeRequest = Parameters<LlmSynthesizeFn>[0];

import { callBrainOnce } from '../../routes/owner/brain-call.js';
import { embedQueryViaOpenAI } from '../../routes/mining/chat-corpus-evidence.js';
import { logger } from '../../utils/logger.js';

// ────────────────────────────────────────────────────────────────────
// Structural-cast helper — the research-tools `ResearchArtifact` /
// `ToolAdapter` and the research-orchestrator ones are independently
// zod-inferred from the *same* spec schemas, so they are structurally
// identical but nominally distinct across the package boundary. The
// orchestrator's registry value type is the canonical one; we cast the
// research-tools adapters into it once, here, at the seam.
// ────────────────────────────────────────────────────────────────────

type RegistryAdapter = ToolAdapter<
  Readonly<Record<string, unknown>>,
  ReadonlyArray<ResearchArtifact>
>;

function asRegistryAdapter(
  adapter: RtToolAdapter<never, never>,
): RegistryAdapter {
  return adapter as unknown as RegistryAdapter;
}

// ────────────────────────────────────────────────────────────────────
// web_search — Tavily primary, Brave fallback. Maps the planner's
// `{ query, depth }` step input to each adapter's typed input and unions
// the results (deduped by source_uri). Freshness-weighted: every web
// query is flagged fast-moving so the scorer's recency decay applies.
// ────────────────────────────────────────────────────────────────────

interface WebSearchInput {
  readonly query?: unknown;
  readonly depth?: unknown;
  readonly max_results?: unknown;
}

function coerceQuery(input: Readonly<Record<string, unknown>>): string {
  const q = (input as WebSearchInput).query;
  if (typeof q === 'string' && q.trim().length > 0) return q.trim();
  // `news_scan` style input carries `terms: string[]` instead of `query`.
  const terms = (input as { readonly terms?: unknown }).terms;
  if (Array.isArray(terms)) {
    const joined = terms.filter((t): t is string => typeof t === 'string').join(' ');
    if (joined.trim().length > 0) return joined.trim();
  }
  return '';
}

function coerceDepth(input: Readonly<Record<string, unknown>>): 'basic' | 'advanced' {
  const d = (input as WebSearchInput).depth;
  return d === 'advanced' ? 'advanced' : 'basic';
}

function dedupeByUri(
  artifacts: ReadonlyArray<ResearchArtifact>,
): ReadonlyArray<ResearchArtifact> {
  const seen = new Set<string>();
  const out: ResearchArtifact[] = [];
  for (const a of artifacts) {
    if (seen.has(a.source_uri)) continue;
    seen.add(a.source_uri);
    out.push(a);
  }
  return out;
}

function createWebSearchAdapter(): RegistryAdapter {
  const tavily = createTavilyAdapter();
  const brave = createBraveAdapter();
  return {
    name: 'web-search-composite',
    version: '1.0.0',
    authority_tier: 0,
    // The composite reserves at the higher of the two single-call costs;
    // the actual measured cost is summed from returned artifacts.
    cost_per_call_usd_cents: Math.max(
      tavily.cost_per_call_usd_cents,
      brave.cost_per_call_usd_cents,
    ),
    async invoke(
      input: Readonly<Record<string, unknown>>,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const query = coerceQuery(input);
      if (query.length === 0) return [];
      const depth = coerceDepth(input);

      // Tavily first (SOTA AI-ready snippets). Each adapter degrades to []
      // on a missing key / soft error, so the union is graceful.
      const tavilyOut = (await tavily.invoke(
        {
          query,
          search_depth: depth,
          is_fast_moving_topic: true,
        } as never,
        ctx as never,
      )) as ReadonlyArray<ResearchArtifact>;

      if (tavilyOut.length > 0) return dedupeByUri(tavilyOut);

      // Fallback to Brave when Tavily produced nothing (e.g. no key).
      const braveOut = (await brave.invoke(
        {
          query,
          is_fast_moving_topic: true,
        } as never,
        ctx as never,
      )) as ReadonlyArray<ResearchArtifact>;
      return dedupeByUri(braveOut);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// news_scan — GDELT (no key needed). Maps `{ terms, window_hours }` to a
// recency-bounded GDELT query.
// ────────────────────────────────────────────────────────────────────

function coerceTimespan(input: Readonly<Record<string, unknown>>): string {
  const hours = (input as { readonly window_hours?: unknown }).window_hours;
  if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0) {
    return `${Math.min(Math.floor(hours), 24 * 30)}h`;
  }
  return '24h';
}

function createNewsScanAdapter(): RegistryAdapter {
  const gdelt = createGdeltAdapter();
  return {
    name: 'news-scan-gdelt',
    version: '1.0.0',
    authority_tier: 0,
    cost_per_call_usd_cents: gdelt.cost_per_call_usd_cents,
    async invoke(
      input: Readonly<Record<string, unknown>>,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const query = coerceQuery(input);
      if (query.length === 0) return [];
      const out = (await gdelt.invoke(
        {
          query,
          timespan: coerceTimespan(input),
        } as never,
        ctx as never,
      )) as ReadonlyArray<ResearchArtifact>;
      return out;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// corpus_query — pgvector ANN over intelligence_corpus_chunks, recency-
// reranked. The orchestrator hands us the tagged-template SQL handle; we
// embed the query (OpenAI, 1024-d to match the column), pull a candidate
// window by vector distance, then re-rank by similarity + ingested-at
// freshness so the freshest authoritative chunk wins ties.
// ────────────────────────────────────────────────────────────────────

type SqlLike = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<unknown>
) => Promise<T>;

interface CorpusRow {
  readonly id: string;
  readonly source_file: string;
  readonly url: string | null;
  readonly text: string;
  readonly ingested_at: string | Date | null;
  readonly distance: number | null;
}

const CORPUS_CANDIDATE_WINDOW = 20;
const CORPUS_TOPK = 6;
const CORPUS_COST_CENTS = 0; // internal retrieval — no external spend.
/** Freshness half-life: a chunk loses half its recency weight per year. */
const CORPUS_FRESHNESS_HALFLIFE_DAYS = 365;
const CORPUS_SIMILARITY_WEIGHT = 0.85;
const CORPUS_FRESHNESS_WEIGHT = 0.15;

function freshnessScore(ingestedAt: string | Date | null): number {
  if (!ingestedAt) return 0;
  const t = ingestedAt instanceof Date ? ingestedAt.getTime() : Date.parse(ingestedAt);
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  // Exponential half-life decay in [0,1].
  return Math.pow(0.5, ageDays / CORPUS_FRESHNESS_HALFLIFE_DAYS);
}

/** Convert pgvector L2 distance into a bounded similarity in [0,1]. */
function similarityFromDistance(distance: number | null): number {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return 0.5;
  return 1 / (1 + Math.max(0, distance));
}

function createCorpusQueryAdapter(sql: SqlLike | null): RegistryAdapter {
  return {
    name: 'corpus-query-pgvector',
    version: '1.0.0',
    authority_tier: 0,
    cost_per_call_usd_cents: CORPUS_COST_CENTS,
    async invoke(
      input: Readonly<Record<string, unknown>>,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      if (!sql) return [];
      const query = coerceQuery(input);
      if (query.length === 0) return [];

      // Embed OUTSIDE any transaction (external round-trip). Null when no
      // OPENAI_API_KEY — we then fall back to the ILIKE keyword path.
      const embedding = await embedQueryViaOpenAI(query);
      const tenantId = ctx.tenant_id;

      let rows: ReadonlyArray<CorpusRow> = [];
      try {
        rows = await fetchCorpusRows(sql, tenantId, query, embedding);
      } catch (err) {
        logger.warn(
          {
            wiring: 'research',
            adapter: 'corpus-query',
            err: err instanceof Error ? err.message : String(err),
          },
          'research: corpus retrieval failed — returning []',
        );
        return [];
      }

      // Recency/freshness re-rank: blend ANN similarity with ingested-at
      // freshness, then take the top-K.
      const ranked = [...rows]
        .map((row) => ({
          row,
          score:
            CORPUS_SIMILARITY_WEIGHT * similarityFromDistance(row.distance) +
            CORPUS_FRESHNESS_WEIGHT * freshnessScore(row.ingested_at),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, CORPUS_TOPK);

      const retrieved_at = new Date().toISOString();
      const artifacts = ranked.map(({ row }, idx) => {
        const uri = row.url && row.url.length > 0 ? row.url : `corpus://${row.source_file}#${row.id}`;
        const id = deriveArtifactId(ctx.step_id, uri, idx);
        const ingestedIso =
          row.ingested_at instanceof Date
            ? row.ingested_at.toISOString()
            : typeof row.ingested_at === 'string'
              ? row.ingested_at
              : undefined;
        return buildArtifact({
          id,
          step_id: ctx.step_id,
          source_uri: uri,
          source_kind: 'corpus',
          title: row.source_file,
          content: row.text,
          excerpt: row.text.slice(0, 500),
          tool_name: 'corpus-query-pgvector',
          cost_usd_cents: 0,
          retrieved_at,
          ...(ingestedIso ? { published_at: ingestedIso } : {}),
        }) as unknown as ResearchArtifact;
      });

      return artifacts;
    },
  };
}

/**
 * Pull the corpus candidate window. pgvector ANN path when an embedding
 * is present, else ILIKE keyword fallback. Tenant-scoped: global
 * (`tenant_id IS NULL`) chunks plus the caller's private chunks. RLS is
 * the DB-side belt (GUC bound per-request by gateway middleware); the
 * explicit predicate here is belt-and-braces. Selects `chunk_text`
 * (live column) with a `text` fallback.
 */
async function fetchCorpusRows(
  sql: SqlLike,
  tenantId: string,
  query: string,
  embedding: ReadonlyArray<number> | null,
): Promise<ReadonlyArray<CorpusRow>> {
  if (embedding && embedding.length > 0) {
    const vecLiteral = `[${embedding.join(',')}]`;
    const raw = await sql<ReadonlyArray<Record<string, unknown>>>`
      SELECT id,
             source_file,
             url,
             COALESCE(chunk_text, text) AS text,
             ingested_at,
             (embedding <-> ${vecLiteral}::vector) AS distance
        FROM intelligence_corpus_chunks
       WHERE (tenant_id IS NULL OR tenant_id = ${tenantId})
         AND embedding IS NOT NULL
       ORDER BY embedding <-> ${vecLiteral}::vector
       LIMIT ${CORPUS_CANDIDATE_WINDOW}
    `;
    return mapCorpusRows(raw);
  }

  // ILIKE keyword fallback — order by ingested_at so the freshest
  // matching chunk surfaces first even without semantic search.
  const like = `%${query.slice(0, 200)}%`;
  const raw = await sql<ReadonlyArray<Record<string, unknown>>>`
    SELECT id,
           source_file,
           url,
           COALESCE(chunk_text, text) AS text,
           ingested_at,
           NULL AS distance
      FROM intelligence_corpus_chunks
     WHERE (tenant_id IS NULL OR tenant_id = ${tenantId})
       AND COALESCE(chunk_text, text) ILIKE ${like}
     ORDER BY ingested_at DESC
     LIMIT ${CORPUS_CANDIDATE_WINDOW}
  `;
  return mapCorpusRows(raw);
}

function mapCorpusRows(
  raw: ReadonlyArray<Record<string, unknown>> | { rows?: ReadonlyArray<Record<string, unknown>> },
): ReadonlyArray<CorpusRow> {
  const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : ((raw as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ?? []);
  return rows
    .map((row) => ({
      id: String(row.id ?? ''),
      source_file: String(row.source_file ?? ''),
      url: typeof row.url === 'string' ? row.url : null,
      text: String(row.text ?? ''),
      ingested_at:
        row.ingested_at instanceof Date
          ? row.ingested_at
          : typeof row.ingested_at === 'string'
            ? row.ingested_at
            : null,
      distance: typeof row.distance === 'number' ? row.distance : null,
    }))
    .filter((r) => r.id.length > 0 && r.text.length > 0);
}

// ────────────────────────────────────────────────────────────────────
// Tool registry — keyed by the orchestrator's `ResearchTool` enum (the
// step-runner looks up `step.tool`). Unmapped tools stay a clean skip.
// ────────────────────────────────────────────────────────────────────

export function buildToolRegistry(
  sql: SqlLike | null,
): ModeRunDeps['toolRegistry'] {
  const web = createWebSearchAdapter();
  const entries: ReadonlyArray<readonly [ResearchTool, RegistryAdapter]> = [
    ['web_search', web],
    // `web_fetch` shares the web-search composite — both surface external
    // web content; the planner uses them interchangeably for shallow vs
    // deep reads and the composite already returns raw content.
    ['web_fetch', web],
    ['news_scan', createNewsScanAdapter()],
    ['corpus_query', createCorpusQueryAdapter(sql)],
  ];
  return new Map(entries);
}

// Re-export the structural caster so a caller could register more adapters
// against the same boundary without re-deriving the cast.
export { asRegistryAdapter };

// ────────────────────────────────────────────────────────────────────
// llmPlan — owner intent → step list, via the brain LLM router.
// ────────────────────────────────────────────────────────────────────

const PLAN_SYSTEM = [
  'You are Mr. Mwikila, the research planner for an AI-native mining estate',
  'operating system. Given an owner research query, produce a minimal ordered',
  'list of research steps. Each step picks exactly one tool from the supplied',
  'AVAILABLE_TOOLS list and provides its input.',
  '',
  'Always start with a corpus_query step (internal ground-truth corpus) when',
  'corpus_query is available, then add web_search / news_scan steps for the',
  'live, time-sensitive dimensions. Keep the plan to at most 5 steps.',
  '',
  'Respond with STRICT JSON only — no prose, no code fence — of the shape:',
  '{ "steps": [ { "tool": "<tool>", "tool_input": { ... } } ] }',
  'For web_search/web_fetch use tool_input { "query": string, "depth": "basic"|"advanced" }.',
  'For news_scan use tool_input { "terms": string[], "window_hours": number }.',
  'For corpus_query use tool_input { "query": string }.',
].join('\n');

interface ParsedPlanStep {
  readonly tool?: unknown;
  readonly tool_input?: unknown;
}

function parsePlanSteps(
  raw: string,
  availableTools: ReadonlyArray<ResearchTool>,
): ReadonlyArray<StepTemplate> {
  // Tolerate a stray code fence the model may wrap around the JSON.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { steps?: ReadonlyArray<ParsedPlanStep> };
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const allowed = new Set<string>(availableTools);
  const out: StepTemplate[] = [];
  for (const s of steps) {
    if (typeof s.tool !== 'string' || !allowed.has(s.tool)) continue;
    const toolInput =
      s.tool_input && typeof s.tool_input === 'object'
        ? (s.tool_input as Readonly<Record<string, unknown>>)
        : {};
    out.push({ tool: s.tool as ResearchTool, tool_input: toolInput });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Build the `llmPlan` function the planner calls. Throws on a missing
 * provider / malformed reply / empty plan so the planner's own try/catch
 * falls back to a rule-based template (it never fails to materialise a
 * plan).
 */
export function createBrainLlmPlan(): (
  req: LlmPlanRequest,
) => Promise<ReadonlyArray<StepTemplate>> {
  return async (req: LlmPlanRequest): Promise<ReadonlyArray<StepTemplate>> => {
    const userPrompt = [
      `QUERY: ${req.query}`,
      `MODE: ${req.mode}`,
      `AVAILABLE_TOOLS: ${req.availableTools.join(', ')}`,
    ].join('\n');
    const { text } = await callBrainOnce({
      systemPrompt: PLAN_SYSTEM,
      userPrompt,
      maxTokens: 700,
    });
    const steps = parsePlanSteps(text, req.availableTools);
    if (steps.length === 0) {
      throw new Error('brain plan returned no usable steps');
    }
    return steps;
  };
}

// ────────────────────────────────────────────────────────────────────
// llmSynthesize — scored artifacts → citation-anchored markdown, via the
// brain LLM router. Grounded: the prompt enumerates each artifact with
// its citation id so the rendered answer cites real sources, and asks for
// explicit cross-reference / disagreement notes.
// ────────────────────────────────────────────────────────────────────

const SYNTH_SYSTEM = [
  'You are Mr. Mwikila, the research synthesizer for an AI-native mining',
  'estate operating system. Compose a concise, decision-grade markdown',
  'briefing that answers the owner QUERY using ONLY the supplied SOURCES.',
  '',
  'Rules:',
  '- Cite every claim inline with its bracketed citation id, e.g. [cit_ab12].',
  '- Cross-reference sources: when two sources agree, note the corroboration;',
  '  when they disagree, surface the disagreement explicitly.',
  '- Prefer the most recent and most authoritative sources; flag staleness.',
  '- Never invent facts or citation ids not present in SOURCES.',
  '- If the SOURCES are empty or insufficient, say so plainly and stop.',
  '- Default to English. Keep it tight: a lead summary then key findings.',
].join('\n');

const MAX_SYNTH_SOURCES = 12;
const MAX_SOURCE_EXCERPT = 800;

/**
 * Build the `llmSynthesize` function the answer-synthesizer calls. Throws
 * on a missing provider / empty reply so the synthesizer's own try/catch
 * falls back to its deterministic rule-based render. The orchestrator
 * stamps span-citations + the audit hash + cross-reference rescoring
 * around whatever body we return, so the result is always grounded +
 * audit-anchored.
 */
export function createBrainLlmSynthesize(): (
  req: LlmSynthesizeRequest,
) => Promise<string> {
  return async (req: LlmSynthesizeRequest): Promise<string> => {
    const sources = req.artifacts.slice(0, MAX_SYNTH_SOURCES);
    if (sources.length === 0) {
      throw new Error('no artifacts to synthesize');
    }
    const sourceBlock = sources
      .map((a) => {
        const flags = a.bias_flags.length > 0 ? ` (flags: ${a.bias_flags.join(', ')})` : '';
        return [
          `[${a.citation_id}] ${a.title} — ${a.source_uri}`,
          `  quality=${a.quality_score.toFixed(2)} class=${a.source_class}${flags}`,
          `  ${a.excerpt || a.content.slice(0, MAX_SOURCE_EXCERPT)}`,
        ].join('\n');
      })
      .join('\n\n');
    const userPrompt = [
      `QUERY: ${req.query}`,
      `MODE: ${req.mode}`,
      '',
      'SOURCES:',
      sourceBlock,
    ].join('\n');
    const { text } = await callBrainOnce({
      systemPrompt: SYNTH_SYSTEM,
      userPrompt,
      maxTokens: 1400,
    });
    if (text.trim().length === 0) {
      throw new Error('brain synthesize returned empty body');
    }
    return text;
  };
}
