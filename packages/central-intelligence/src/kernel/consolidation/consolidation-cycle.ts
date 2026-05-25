/**
 * Reflection + consolidation cycle — orchestrator.
 *
 * The brain's "sleep" pass. Reads recent episodic entries for a
 * (tenant, user) scope and:
 *
 *   1. Extracts SEMANTIC FACTS via a small Haiku judge call. Each
 *      fact is schema-validated and upserted into semantic memory.
 *   2. Detects PROCEDURAL PATTERNS by sliding a window over the
 *      tool-result episodic stream. A 3-step (default) tool sequence
 *      that repeats >=2 times within the window is recorded as a
 *      named procedural pattern.
 *   3. On a weekly run, generates a REFLECTIVE DIGEST via another
 *      Haiku call (summary + top topics + sentiment + action items)
 *      and stores it in reflective memory.
 *   4. Calls episodic.purgeExpired() to enforce TTL.
 *   5. Calls semantic.decay({decayPerDay: 0.005}) once per day
 *      equivalent so old facts fade unless re-seen.
 *
 * Every external call (judge, port writes) is defensively wrapped:
 * a failure inside any phase logs a warning and continues. The cycle
 * NEVER throws on model-side or DB-side errors — it returns a report
 * with an `errors` array describing what skipped. Hard programmer
 * errors (bad scope, bad config) still throw at the entry boundary.
 *
 * The shapes/schemas the judge is asked to return are JSON; the cycle
 * extracts the first balanced JSON value from the body and validates
 * it with zod. Invalid JSON is logged and returns 0 extracted facts /
 * an empty digest.
 */

import { z } from 'zod';
import type {
  EpisodicEntry,
  ProceduralPattern,
} from '../memory/index.js';
import {
  DEFAULT_CONSOLIDATION_CONFIG,
  type ConsolidationConfig,
  type ConsolidationDeps,
  type ConsolidationLogger,
  type ConsolidationReport,
  type ConsolidationScope,
  type ExtractedFact,
  type ReflectiveDigestPayload,
} from './consolidation-types.js';
import { logger } from '../../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────────────

export async function runConsolidationCycle(
  deps: ConsolidationDeps,
  scope: ConsolidationScope,
  config?: Partial<ConsolidationConfig>,
): Promise<ConsolidationReport> {
  if (!scope) {
    throw new Error('runConsolidationCycle: scope is required');
  }
  const logger = deps.logger ?? defaultLogger();
  const cfg: ConsolidationConfig = { ...DEFAULT_CONSOLIDATION_CONFIG, ...(config ?? {}) };
  const errors: string[] = [];
  const startedAt = new Date().toISOString();
  const now = cfg.now ?? new Date();

  // ─────────────── Phase 0: read recent episodic ───────────────
  const since = new Date(now.getTime() - cfg.windowDays * 24 * 60 * 60 * 1000);
  let episodic: ReadonlyArray<EpisodicEntry> = [];
  if (scope.userId) {
    try {
      episodic = await deps.episodic.recall({
        tenantId: scope.tenantId,
        userId: scope.userId,
        since: since.toISOString(),
        limit: cfg.maxEpisodicEntries,
      });
    } catch (error) {
      const msg = `episodic.recall failed: ${asMsg(error)}`;
      logger.warn(msg);
      errors.push(msg);
      episodic = [];
    }
  }

  const episodicConsidered = episodic.length;

  // ─────────────── Phase 1: extract semantic facts ───────────────
  let factsExtracted = 0;
  let factsUpserted = 0;
  if (scope.userId && episodic.length > 0) {
    const facts = await extractFacts(deps, episodic, logger, errors);
    factsExtracted = facts.length;
    for (const fact of facts) {
      if (fact.confidence < cfg.minFactConfidence) continue;
      try {
        await deps.semantic.upsertFact({
          tenantId: scope.tenantId,
          userId: scope.userId,
          key: fact.key,
          value: { value: fact.value, evidence: fact.evidence },
          confidence: fact.confidence,
          source: 'consolidated',
        });
        factsUpserted += 1;
      } catch (error) {
        const msg = `semantic.upsertFact failed for key=${fact.key}: ${asMsg(error)}`;
        logger.warn(msg);
        errors.push(msg);
      }
    }
  }

  // ─────────────── Phase 2: detect procedural patterns ───────────────
  let patternsRecorded = 0;
  if (scope.userId && episodic.length > 0) {
    const patterns = detectPatterns(episodic, cfg);
    for (const p of patterns) {
      try {
        await deps.procedural.record({
          tenantId: scope.tenantId,
          userId: scope.userId,
          patternName: p.patternName,
          toolSequence: p.toolSequence,
          triggerKeywords: p.triggerKeywords,
          success: true,
        });
        patternsRecorded += 1;
      } catch (error) {
        const msg = `procedural.record failed for ${p.patternName}: ${asMsg(error)}`;
        logger.warn(msg);
        errors.push(msg);
      }
    }
  }

  // ─────────────── Phase 3: weekly reflective digest ───────────────
  let digestsWritten = 0;
  if (scope.periodKind === 'weekly' && episodic.length > 0) {
    const digest = await generateDigest(deps, episodic, logger, errors);
    if (digest) {
      try {
        await deps.reflective.record({
          tenantId: scope.tenantId,
          userId: scope.userId ?? null,
          periodKind: 'weekly',
          periodStart: since.toISOString(),
          periodEnd: now.toISOString(),
          summary: digest.summary,
          topTopics: digest.topTopics,
          sentimentAvg: digest.sentimentAvg,
          actionItems: digest.actionItems,
        });
        digestsWritten = 1;
      } catch (error) {
        const msg = `reflective.record failed: ${asMsg(error)}`;
        logger.warn(msg);
        errors.push(msg);
      }
    }
  }

  // ─────────────── Phase 4: purge expired episodic ───────────────
  let expiredPurged = 0;
  if (cfg.purgeExpired) {
    try {
      expiredPurged = await deps.episodic.purgeExpired();
    } catch (error) {
      const msg = `episodic.purgeExpired failed: ${asMsg(error)}`;
      logger.warn(msg);
      errors.push(msg);
    }
  }

  // ─────────────── Phase 5: decay semantic confidence ───────────────
  let decayedFacts = 0;
  if (cfg.applyDecay) {
    try {
      decayedFacts = await deps.semantic.decay({
        tenantId: scope.tenantId,
        decayPerDay: cfg.decayPerDay,
      });
    } catch (error) {
      const msg = `semantic.decay failed: ${asMsg(error)}`;
      logger.warn(msg);
      errors.push(msg);
    }
  }

  return {
    scope,
    episodicConsidered,
    factsExtracted,
    factsUpserted,
    patternsRecorded,
    digestsWritten,
    expiredPurged,
    decayedFacts,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Fact extraction (Haiku judge)
// ─────────────────────────────────────────────────────────────────────

export const FACT_EXTRACTION_SYSTEM_PROMPT = `You are a memory consolidation judge for a property-management AI brain. Read these N user/agent turns. Return a JSON array of {key, value, confidence, evidence} facts about the user's preferences, ongoing situations, or property-specific knowledge. Only include facts a brain should remember next week. Use lower_snake_case keys (e.g. "preferred_communication_channel", "pending_arrears_case_a12"). Confidence is a number in [0,1] where 1.0 means stated explicitly and 0.4 means a soft signal. Evidence is the shortest verbatim quote from the turns that justifies the fact. Return ONLY the JSON array. No markdown. No commentary. If no durable facts can be extracted, return [].`;

const factSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v)),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(800).default(''),
});
const factArraySchema = z.array(factSchema);

async function extractFacts(
  deps: ConsolidationDeps,
  entries: ReadonlyArray<EpisodicEntry>,
  logger: ConsolidationLogger,
  errors: string[],
): Promise<ReadonlyArray<ExtractedFact>> {
  const userPrompt = renderEntriesForJudge(entries);
  let body = '';
  try {
    body = await deps.judge.call({
      system: FACT_EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1024,
    });
  } catch (error) {
    const msg = `fact-extraction judge failed: ${asMsg(error)}`;
    logger.warn(msg);
    errors.push(msg);
    return [];
  }

  const parsed = parseJsonValue(body);
  if (parsed === undefined) {
    logger.warn('fact-extraction: could not extract JSON from judge body');
    return [];
  }
  const result = factArraySchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('fact-extraction: schema validation failed', { issues: result.error.issues.length });
    return [];
  }
  return result.data;
}

function renderEntriesForJudge(entries: ReadonlyArray<EpisodicEntry>): string {
  const lines: string[] = [];
  for (const e of entries) {
    const speaker =
      e.kind === 'user-message'
        ? 'USER'
        : e.kind === 'agent-action'
          ? 'AGENT'
          : 'TOOL';
    lines.push(`${speaker}: ${e.summary}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Procedural pattern detection
// ─────────────────────────────────────────────────────────────────────

interface DetectedPattern {
  readonly patternName: string;
  readonly toolSequence: ReadonlyArray<string>;
  readonly triggerKeywords: ReadonlyArray<string>;
}

/**
 * Algorithm — sliding window over tool invocations.
 *
 *   1. Build the ordered list of tool names from `agent-action` entries
 *      whose payload carries `toolName: string` (or fall back to the
 *      summary's leading word). User-message entries reset the
 *      "current trigger keyword set" so a sequence is anchored to a
 *      single user request.
 *   2. Slide a window of size `cfg.patternWindowSize` over the tool
 *      list. Each window is a sequence; count how many times each
 *      sequence appears. Sequences with count >= cfg.minPatternRepeats
 *      qualify.
 *   3. For each qualifying sequence, derive trigger keywords from the
 *      most recent user-message before its first occurrence (top-N
 *      tokens, deduplicated, lowercased, length>=3).
 */
function detectPatterns(
  entries: ReadonlyArray<EpisodicEntry>,
  cfg: ConsolidationConfig,
): ReadonlyArray<DetectedPattern> {
  // chronological order — `recall` returns descending; reverse here.
  const ordered = [...entries].reverse();

  // Build pairs: (toolName, anchorKeywords) — anchor is the most recent
  // user message before this tool call.
  const tools: Array<{ name: string; anchorKeywords: ReadonlyArray<string> }> = [];
  let currentAnchor: ReadonlyArray<string> = [];
  for (const e of ordered) {
    if (e.kind === 'user-message') {
      currentAnchor = topKeywords(e.summary, 6);
      continue;
    }
    if (e.kind === 'agent-action' || e.kind === 'tool-result') {
      const name = extractToolName(e);
      if (!name) continue;
      tools.push({ name, anchorKeywords: currentAnchor });
    }
  }

  if (tools.length < cfg.patternWindowSize) return [];

  // Slide window of size N.
  const windowSize = Math.max(2, Math.floor(cfg.patternWindowSize));
  const seen = new Map<
    string,
    { sequence: ReadonlyArray<string>; count: number; anchor: ReadonlyArray<string> }
  >();
  for (let i = 0; i + windowSize <= tools.length; i++) {
    const slice = tools.slice(i, i + windowSize);
    const seq = slice.map((s) => s.name);
    const key = seq.join('>');
    const prior = seen.get(key);
    if (prior) {
      seen.set(key, { ...prior, count: prior.count + 1 });
    } else {
      seen.set(key, {
        sequence: seq,
        count: 1,
        // Use the FIRST occurrence's anchor — it's the keyword set
        // that triggered the pattern initially.
        anchor: slice[0]?.anchorKeywords ?? [],
      });
    }
  }

  const minRepeats = Math.max(2, Math.floor(cfg.minPatternRepeats));
  const out: DetectedPattern[] = [];
  for (const [key, v] of seen) {
    if (v.count < minRepeats) continue;
    out.push({
      patternName: namePattern(key),
      toolSequence: v.sequence,
      triggerKeywords: v.anchor,
    });
  }
  return out;
}

function namePattern(key: string): string {
  // Compact, deterministic name; bounded length.
  const safe = key.replace(/[^a-zA-Z0-9_>-]/g, '_').slice(0, 100);
  return `auto:${safe}`;
}

function extractToolName(e: EpisodicEntry): string | null {
  const fromPayload = (e.payload && typeof e.payload === 'object'
    ? (e.payload as Record<string, unknown>).toolName
    : undefined);
  if (typeof fromPayload === 'string' && fromPayload.trim().length > 0) {
    return fromPayload.trim();
  }
  // Fallback: first word of summary, if it looks like a tool slug.
  const word = e.summary?.trim().split(/\s+/, 1)[0] ?? '';
  if (/^[a-z][a-z0-9_.\-:]{1,48}$/i.test(word)) return word;
  return null;
}

function topKeywords(text: string, limit: number): ReadonlyArray<string> {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= limit) break;
  }
  return out;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any',
  'can', 'her', 'was', 'one', 'our', 'out', 'his', 'has', 'had',
  'let', 'put', 'say', 'she', 'too', 'use', 'with', 'this', 'that',
  'have', 'from', 'your', 'there', 'their', 'about', 'would', 'could',
  'should', 'them', 'were',
]);

// ─────────────────────────────────────────────────────────────────────
// Reflective digest (Haiku judge)
// ─────────────────────────────────────────────────────────────────────

export const REFLECTIVE_DIGEST_SYSTEM_PROMPT = `You summarize a week of conversation between a property-management AI brain and one user. Read the N turns provided and return a single JSON object: {summary (string, <=400 chars), top_topics (array of {topic: string, count: number}), sentiment_avg (number in [-1, 1]), action_items (array of strings)}. The summary should be a tight third-person paragraph capturing the dominant themes. top_topics should be at most 5 entries ordered by frequency. sentiment_avg averages the user's affect across the week (-1 negative, 0 neutral, 1 positive); use null only if undeterminable. action_items are concrete next steps the brain or the user committed to. Return ONLY the JSON object. No markdown. No commentary.`;

const digestSchema = z.object({
  summary: z.string().min(1).max(2000),
  top_topics: z
    .array(
      z.object({
        topic: z.string().min(1).max(60),
        count: z.number().int().min(0),
      }),
    )
    .max(20)
    .default([]),
  sentiment_avg: z.union([z.number().min(-1).max(1), z.null()]).default(null),
  action_items: z.array(z.string().min(1).max(400)).max(20).default([]),
});

async function generateDigest(
  deps: ConsolidationDeps,
  entries: ReadonlyArray<EpisodicEntry>,
  logger: ConsolidationLogger,
  errors: string[],
): Promise<ReflectiveDigestPayload | null> {
  const userPrompt = renderEntriesForJudge(entries);
  let body = '';
  try {
    body = await deps.judge.call({
      system: REFLECTIVE_DIGEST_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1024,
    });
  } catch (error) {
    const msg = `reflective-digest judge failed: ${asMsg(error)}`;
    logger.warn(msg);
    errors.push(msg);
    return null;
  }

  const parsed = parseJsonValue(body);
  if (parsed === undefined) {
    logger.warn('reflective-digest: could not extract JSON from judge body');
    return null;
  }
  const result = digestSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('reflective-digest: schema validation failed', {
      issues: result.error.issues.length,
    });
    return null;
  }
  return {
    summary: result.data.summary,
    topTopics: result.data.top_topics.map((t) => ({ topic: t.topic, count: t.count })),
    sentimentAvg: result.data.sentiment_avg,
    actionItems: result.data.action_items,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the first JSON value (object or array) from a free-form
 * string. Returns undefined when no balanced JSON value can be parsed.
 * The judge is asked to return ONLY JSON, but real models occasionally
 * wrap it in code fences or prose; this isolates the value before
 * parsing.
 */
function parseJsonValue(body: string): unknown {
  if (!body) return undefined;
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  const candidates = collectJsonCandidates(trimmed);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function collectJsonCandidates(s: string): ReadonlyArray<string> {
  const out: string[] = [];
  // Try the whole string first.
  out.push(s);
  // Try the first {...} block.
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) out.push(objMatch[0]);
  // Try the first [...] block.
  const arrMatch = s.match(/\[[\s\S]*\]/);
  if (arrMatch) out.push(arrMatch[0]);
  return out;
}

function asMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultLogger(): ConsolidationLogger {
  return {
    warn(msg, meta) {
      logger.warn(`[consolidation] ${msg}`, { value: meta ?? '' })
    },
  };
}

// Re-export for callers that want to inspect a detected pattern shape
// (e.g. a UI dashboard that surfaces "the brain learned X").
export type { DetectedPattern };
export type { ProceduralPattern };
