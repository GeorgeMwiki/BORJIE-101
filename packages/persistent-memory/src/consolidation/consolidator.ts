/**
 * Real consolidator (MEM-05).
 *
 * The consolidation worker (`services/consolidation-worker`) shipped only a
 * deterministic STUB consolidator: "1 fact per N turns" with a fixed
 * `recent-topic` key whose value is just the latest summary
 * (`consolidation.ts:createStubConsolidator`). That is not real consolidation —
 * it never abstracts a durable semantic fact from the reservoir, it just
 * forwards the most-recent raw summaries. MASTER_GAP_REGISTER MEM-05.
 *
 * This module is the REAL consolidation pass, expressed as a plug-in over the
 * SAME `ConsolidatorPort` structural shape the worker already wires, so closing
 * the gap is a one-line swap there:
 *
 *   - import { createStubConsolidator } …      // before
 *   + import { createBrainConsolidator } from '@borjie/persistent-memory'
 *     const consolidator = createBrainConsolidator({ brain })   // after
 *
 * Two execution modes, selected by whether a `brain` port is supplied:
 *
 *   1. BRAIN mode — a cheap LLM (Haiku-class) reads the grouped reservoir
 *      entries and extracts a small set of DURABLE semantic facts
 *      (`{ key, value, confidence }`), each abstracting a stable user
 *      preference / decision / recurring topic rather than echoing a raw turn.
 *      The prompt forces strict JSON; a parse failure degrades to the
 *      deterministic pass (never throws).
 *
 *   2. DETERMINISTIC mode (no brain, or brain failure) — a real frequency +
 *      recency aggregator: it ranks the most-recurring topic tokens across the
 *      group and emits one fact per salient topic (not "1 per N raw turns"),
 *      with a confidence that scales with how often the topic recurs. This is a
 *      genuine consolidation heuristic, strictly better than the stub, and is
 *      dependency-free so the package builds + tests without an LLM.
 *
 * Immutability + purity: no input is mutated; the function is referentially
 * transparent given a deterministic `brain`/clock. No `console.*` — the worker
 * owns logging.
 */

// ---------------------------------------------------------------------------
// Port shapes — structurally identical to the worker's
// `services/consolidation-worker/src/consolidation.ts` so this is a drop-in.
// We re-declare them here (rather than import across the service boundary) to
// keep the package free of any service dependency.
// ---------------------------------------------------------------------------

export interface ReservoirEntry {
  readonly thoughtId: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly capturedAt: string;
}

export interface ConsolidatedFact {
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
}

export interface ConsolidateArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly entries: ReadonlyArray<ReservoirEntry>;
}

export interface ConsolidatorPort {
  consolidate(args: ConsolidateArgs): Promise<ReadonlyArray<ConsolidatedFact>>;
}

/**
 * Brain port — supply a Claude/OpenAI/Anthropic adapter. Mirrors the
 * `Brain.summarise` shape already used by `@borjie/memory-v2` so the host can
 * pass the same adapter. The consolidator sends the grouped summaries and a
 * strict-JSON system prompt; the adapter returns the model's raw text.
 */
export interface ConsolidationBrainPort {
  summarise(
    transcript: ReadonlyArray<{ role: string; content: string }>,
    systemPrompt: string,
  ): Promise<string>;
}

export interface BrainConsolidatorConfig {
  /** Optional LLM. When omitted, the deterministic pass runs alone. */
  readonly brain?: ConsolidationBrainPort;
  /** Max facts emitted per (tenant, user) group. Default 5. */
  readonly maxFactsPerGroup?: number;
  /** Min entries before consolidation runs at all. Default 2. */
  readonly minEntries?: number;
  /** Confidence assigned to LLM-extracted facts. Default 0.7. */
  readonly brainConfidence?: number;
}

const DEFAULT_MAX_FACTS = 5;
const DEFAULT_MIN_ENTRIES = 2;
const DEFAULT_BRAIN_CONFIDENCE = 0.7;

const CONSOLIDATION_SYSTEM_PROMPT = [
  'You consolidate a working memory reservoir into DURABLE semantic facts.',
  'You are given a chronological list of short turn summaries for ONE user.',
  'Extract only STABLE facts worth remembering across sessions: preferences,',
  'decisions, recurring topics, constraints, named entities. Do NOT echo a',
  'single raw turn; ABSTRACT across the group. Prefer fewer, higher-value facts.',
  'Return STRICT JSON only — no preamble, no markdown:',
  '{ "facts": [ { "key": string, "value": string, "confidence": number } ] }',
  'key is a short snake_case slug (e.g. "preferred_currency"). confidence is in',
  '[0,1]. Return { "facts": [] } when nothing is durable.',
].join('\n');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBrainConsolidator(
  config: BrainConsolidatorConfig = {},
): ConsolidatorPort {
  const maxFacts = clampPositiveInt(config.maxFactsPerGroup, DEFAULT_MAX_FACTS);
  const minEntries = clampPositiveInt(config.minEntries, DEFAULT_MIN_ENTRIES);
  const brainConfidence = clampUnit(
    config.brainConfidence ?? DEFAULT_BRAIN_CONFIDENCE,
  );

  return {
    async consolidate({ entries }): Promise<ReadonlyArray<ConsolidatedFact>> {
      if (entries.length < minEntries) return [];

      // Order newest-first for stable prompting + recency weighting.
      const ordered = [...entries].sort((a, b) =>
        a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0,
      );

      if (config.brain) {
        const viaBrain = await tryBrainConsolidate(
          config.brain,
          ordered,
          maxFacts,
          brainConfidence,
        );
        if (viaBrain !== null) return viaBrain;
        // Brain failure / empty / unparseable → fall through to deterministic.
      }

      return deterministicConsolidate(ordered, maxFacts);
    },
  };
}

// ---------------------------------------------------------------------------
// BRAIN mode
// ---------------------------------------------------------------------------

async function tryBrainConsolidate(
  brain: ConsolidationBrainPort,
  ordered: ReadonlyArray<ReservoirEntry>,
  maxFacts: number,
  confidence: number,
): Promise<ReadonlyArray<ConsolidatedFact> | null> {
  const transcript = ordered.map((e) => ({
    role: 'user' as const,
    content: e.summary,
  }));
  let raw: string;
  try {
    raw = await brain.summarise(transcript, CONSOLIDATION_SYSTEM_PROMPT);
  } catch {
    return null; // brain unavailable → caller falls back to deterministic.
  }
  const parsed = parseFactsJson(raw);
  if (parsed === null) return null;
  // Normalise + bound. Drop empties; clamp confidence; cap count.
  const facts: ConsolidatedFact[] = [];
  for (const f of parsed) {
    const key = typeof f.key === 'string' ? f.key.trim() : '';
    const value = typeof f.value === 'string' ? f.value.trim() : '';
    if (key.length === 0 || value.length === 0) continue;
    const conf =
      typeof f.confidence === 'number' && Number.isFinite(f.confidence)
        ? clampUnit(f.confidence)
        : confidence;
    facts.push({ key, value, confidence: conf });
    if (facts.length >= maxFacts) break;
  }
  // An empty array from a SUCCESSFUL parse means "nothing durable" — honor it
  // (do NOT fall back to deterministic, which would re-introduce noise).
  return facts;
}

interface RawFact {
  key?: unknown;
  value?: unknown;
  confidence?: unknown;
}

function parseFactsJson(raw: string): ReadonlyArray<RawFact> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  const candidate = match?.[0] ?? raw;
  try {
    const parsed = JSON.parse(candidate) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return null;
    return parsed.facts as ReadonlyArray<RawFact>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DETERMINISTIC mode — frequency + recency topic aggregator.
//
// A genuine consolidation heuristic (not the stub's "1 raw turn per N"): it
// tokenises the summaries, ranks the most-recurring salient topic tokens, and
// emits one fact per topic whose value is the most-recent summary mentioning
// it, with a confidence that grows with recurrence. Recurring topics across
// many turns are exactly what is worth remembering.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'your',
  'you', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'what', 'when',
  'where', 'which', 'who', 'how', 'why', 'a', 'an', 'of', 'to', 'in', 'on',
  'at', 'by', 'is', 'it', 'be', 'as', 'or', 'if', 'we', 'i', 'me', 'my',
  'user', 'asked', 'assistant', 'answered', 'turn', 'summary',
]);

function deterministicConsolidate(
  ordered: ReadonlyArray<ReservoirEntry>,
  maxFacts: number,
): ReadonlyArray<ConsolidatedFact> {
  const total = ordered.length;
  // token → { count, mostRecentSummary }
  const topics = new Map<string, { count: number; recent: string }>();
  for (const entry of ordered) {
    const seen = new Set<string>();
    for (const tok of tokenise(entry.summary)) {
      if (seen.has(tok)) continue; // count each topic at most once per turn
      seen.add(tok);
      const existing = topics.get(tok);
      if (existing) {
        existing.count += 1;
      } else {
        // `ordered` is newest-first, so the FIRST time we see a token its
        // summary is the most-recent mention.
        topics.set(tok, { count: 1, recent: entry.summary });
      }
    }
  }

  const ranked = Array.from(topics.entries())
    .filter(([, v]) => v.count >= 2) // only RECURRING topics are durable
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxFacts);

  if (ranked.length === 0) {
    // No recurring topic — fall back to a single most-recent-topic fact so the
    // pass still advances the reservoir cursor (parity with the old stub's one
    // guaranteed output, but keyed honestly).
    const newest = ordered[0];
    if (!newest) return [];
    return [
      {
        key: 'recent_topic',
        value: { summary: newest.summary, sourceTurnId: newest.thoughtId },
        confidence: 0.5,
      },
    ];
  }

  return ranked.map(([topic, v]) => ({
    key: `topic_${topic}`,
    value: { topic, mentions: v.count, latestSummary: v.recent },
    // Confidence scales with how much of the window mentioned the topic,
    // floored at 0.5 and capped at 0.95.
    confidence: Math.min(0.95, 0.5 + (v.count / total) * 0.45),
  }));
}

function tokenise(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// ---------------------------------------------------------------------------
// Small numeric guards
// ---------------------------------------------------------------------------

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
