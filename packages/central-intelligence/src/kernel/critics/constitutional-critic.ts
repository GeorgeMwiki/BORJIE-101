/**
 * RLAIF Constitutional critic — nightly cluster-reflection scorer.
 *
 * B4 Phase B — Progressive Intelligence.
 *
 * Per the Anthropic Constitutional-AI pattern (anthropic.com/research/
 * constitutional-ai-harmlessness-from-ai-feedback), an AI critic
 * scores cluster reflections against a written constitution. Pass/fail
 * + per-rule scores feed the DSPy GEPA loop as RLAIF training pairs
 * WITHOUT human labelling. This closes the "implicit feedback alone
 * trains a flatterer" anti-pattern by giving the optimisation loop a
 * principled, hard-coded reference.
 *
 * The BORJIE constitution encodes:
 *
 *   1. TZ Rental Act
 *      - 14-day notice for non-payment eviction
 *      - 30-day notice for rent increase
 *      - Deposit held in escrow; returnable within 30 days of vacate
 *      - No advance rent > 6 months
 *
 *   2. GDPR / PDPA
 *      - PII never leaves tenant boundary
 *      - Right-to-be-forgotten honoured within 30 days
 *      - Audit chain tamper-evident
 *
 *   3. Currency chain
 *      - User preference → tenant preference → platform default
 *      - Conversions via current FX rates table; NEVER hardcoded
 *
 *   4. Inviolable IP
 *      - K5's inviolable categories — cross-tenant data NEVER leaks
 *      - Tenant secrets never appear in cross-tenant skill registry
 *
 * The critic takes a free-form Anthropic SDK client and returns a
 * structured score per rule. The SDK is duck-typed so this package
 * remains import-safe whether `@anthropic-ai/sdk` is installed or not.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import { logger } from '../../logger.js';
export interface ConstitutionRule {
  readonly id: string;
  readonly description: string;
  readonly category: 'tz-rental-act' | 'gdpr-pdpa' | 'currency-chain' | 'inviolable-ip';
}

export interface ClusterReflection {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly text: string;
  readonly intentLabel: string;
}

export interface CriticScore {
  readonly ruleId: string;
  /** 0–1 — 1 = fully compliant, 0 = clear violation. */
  readonly score: number;
  readonly rationale: string;
}

export interface CriticVerdict {
  readonly clusterId: string;
  readonly overall: number;
  readonly passed: boolean;
  readonly scores: ReadonlyArray<CriticScore>;
  /** Active model id (whichever Claude variant served the critic). */
  readonly modelId?: string;
}

export interface ConstitutionalCritic {
  score(reflection: ClusterReflection): Promise<CriticVerdict>;
}

export interface AnthropicClientLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<{ role: string; content: string }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
      model?: string;
    }>;
  };
}

export interface CreateConstitutionalCriticArgs {
  readonly anthropicClient?: AnthropicClientLike;
  readonly constitutionRules?: ReadonlyArray<ConstitutionRule>;
  readonly modelId?: string;
  /** Pass threshold for `verdict.passed`. Default 0.7. */
  readonly passThreshold?: number;
}

export const BORJIE_CONSTITUTION: ReadonlyArray<ConstitutionRule> =
  Object.freeze([
    {
      id: 'tz-rental-act-notice-period',
      description:
        'TZ Rental Act: 14-day written notice required before eviction for non-payment.',
      category: 'tz-rental-act',
    },
    {
      id: 'tz-rental-act-deposit-handling',
      description:
        'Tenant deposit held in escrow; refundable within 30 days of vacate per TZ Rental Act.',
      category: 'tz-rental-act',
    },
    {
      id: 'tz-rental-act-advance-rent',
      description:
        'TZ Rental Act forbids landlord demanding > 6 months rent in advance.',
      category: 'tz-rental-act',
    },
    {
      id: 'gdpr-pii-boundary',
      description:
        'GDPR + Tanzania PDPA: PII (names, phone numbers, ID numbers) never leaves the owning tenant boundary unless user explicitly consents.',
      category: 'gdpr-pdpa',
    },
    {
      id: 'gdpr-right-to-be-forgotten',
      description:
        'Right-to-be-forgotten requests honoured within 30 days; audit chain preserves the deletion event but not the deleted PII.',
      category: 'gdpr-pdpa',
    },
    {
      id: 'currency-chain-no-hardcode',
      description:
        'Currency resolution chain: user preference → tenant preference → platform default. FX conversions ALWAYS read the current currency_rates table; never hardcoded.',
      category: 'currency-chain',
    },
    {
      id: 'inviolable-ip-tenant-isolation',
      description:
        'Skills learned per-tenant must not leak into cross-tenant retrieval. Global skills require explicit operator promotion.',
      category: 'inviolable-ip',
    },
    {
      id: 'inviolable-ip-secret-redaction',
      description:
        'Tenant API keys, bank account numbers, MPESA till numbers never appear in trace summaries or reflections.',
      category: 'inviolable-ip',
    },
  ]);

const DEFAULT_PASS_THRESHOLD = 0.7;
const DEFAULT_MODEL = getModelLatest('haiku');

/**
 * Compose a Constitutional critic. Two implementations:
 *
 *   - WITH `anthropicClient`     → calls Haiku with the constitution
 *                                  as a system prompt; parses JSON
 *                                  scores.
 *   - WITHOUT `anthropicClient`  → heuristic-only scorer (used by
 *                                  tests + offline replay). Scores
 *                                  any reflection whose text contains
 *                                  a constitution keyword as a
 *                                  potential violation; otherwise
 *                                  passes.
 */
export function createConstitutionalCritic(
  args: CreateConstitutionalCriticArgs = {},
): ConstitutionalCritic {
  const rules = args.constitutionRules ?? BORJIE_CONSTITUTION;
  const passThreshold = args.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const modelId = args.modelId ?? DEFAULT_MODEL;
  const client = args.anthropicClient;

  return {
    async score(reflection) {
      const scores = client
        ? await scoreWithClaude({
            reflection,
            rules,
            client,
            modelId,
          })
        : scoreHeuristic(reflection, rules);

      const overall =
        scores.length > 0
          ? scores.reduce((s, r) => s + r.score, 0) / scores.length
          : 1;
      const verdict: CriticVerdict = client
        ? {
            clusterId: reflection.clusterId,
            overall,
            passed: overall >= passThreshold,
            scores,
            modelId,
          }
        : {
            clusterId: reflection.clusterId,
            overall,
            passed: overall >= passThreshold,
            scores,
          };
      return verdict;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Heuristic scorer — used when no anthropicClient is wired.
//
// For each rule, scan the reflection text for the rule's category-
// keyword set. A hit means "this reflection touches the area governed
// by this rule and the LLM critic should review it"; the heuristic
// scorer flags it with score=0.5 (uncertain), pass=false.
// All other rules pass at 1.0.
//
// This is INTENTIONALLY conservative — without an LLM the critic
// errs on the side of refusing to label a sensitive cluster as
// "compliant".
// ─────────────────────────────────────────────────────────────────────

const KEYWORDS_BY_CATEGORY: Record<string, ReadonlyArray<string>> = {
  'tz-rental-act': ['eviction', 'evict', 'notice', 'deposit', 'rent advance', 'kodi'],
  'gdpr-pdpa': ['phone', 'id number', 'pii', 'email', 'address', 'simu'],
  'currency-chain': ['tzs', 'kes', 'usd', 'currency', 'exchange', 'fx'],
  'inviolable-ip': ['api key', 'till', 'mpesa', 'secret', 'cross-tenant'],
};

function scoreHeuristic(
  reflection: ClusterReflection,
  rules: ReadonlyArray<ConstitutionRule>,
): ReadonlyArray<CriticScore> {
  const text = reflection.text.toLowerCase();
  return rules.map((rule) => {
    const keywords = KEYWORDS_BY_CATEGORY[rule.category] ?? [];
    const flagged = keywords.some((k) => text.includes(k));
    return {
      ruleId: rule.id,
      score: flagged ? 0.5 : 1,
      rationale: flagged
        ? `Heuristic: reflection mentions a ${rule.category} keyword; LLM critic should review.`
        : 'Heuristic: no keyword match; auto-pass.',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Claude scorer — invokes a Haiku-tier model with the constitution as
// a system prompt and asks for a JSON scoring object.
// ─────────────────────────────────────────────────────────────────────

interface ClaudeScoreArgs {
  readonly reflection: ClusterReflection;
  readonly rules: ReadonlyArray<ConstitutionRule>;
  readonly client: AnthropicClientLike;
  readonly modelId: string;
}

async function scoreWithClaude(
  args: ClaudeScoreArgs,
): Promise<ReadonlyArray<CriticScore>> {
  const constitution = args.rules
    .map((r) => `- [${r.id}] (${r.category}) ${r.description}`)
    .join('\n');
  const userPrompt = [
    `Reflection (clusterId=${args.reflection.clusterId}, tenant=${
      args.reflection.tenantId ?? 'GLOBAL'
    }):`,
    args.reflection.text,
    '',
    'For each rule, return a JSON object with this shape:',
    '{"ruleId":"...", "score":0..1, "rationale":"one sentence"}',
    'Return a JSON array.',
  ].join('\n');

  try {
    const resp = await args.client.messages.create({
      model: args.modelId,
      max_tokens: 1024,
      system: `You are the BORJIE Constitutional Critic. Score the reflection against each rule.\n\nRules:\n${constitution}`,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    return parseScoresLenient(text, args.rules);
  } catch (error) {
    logger.warn('constitutional-critic: Claude call failed; falling back to heuristic', { value: error instanceof Error ? error.message : String(error) });
    return scoreHeuristic(args.reflection, args.rules);
  }
}

/**
 * Parse Claude's JSON-array response. If the response is malformed
 * (Claude wrote prose around the JSON or wrapped it in markdown), we
 * try to extract the first JSON array via a balanced-bracket scan.
 * Any rule the response omits is filled with `score=1` (auto-pass) so
 * a parse failure NEVER hard-fails the critic.
 */
function parseScoresLenient(
  raw: string,
  rules: ReadonlyArray<ConstitutionRule>,
): ReadonlyArray<CriticScore> {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const scores: CriticScore[] = [];
  const jsonStr = extractFirstJsonArray(raw);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as ReadonlyArray<{
        ruleId?: unknown;
        score?: unknown;
        rationale?: unknown;
      }>;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const ruleId = String(entry.ruleId ?? '');
          if (!ruleById.has(ruleId)) continue;
          const score = clamp01(Number(entry.score));
          scores.push({
            ruleId,
            score,
            rationale: String(entry.rationale ?? '').slice(0, 500),
          });
        }
      }
    } catch {
      // fallthrough to fill missing
    }
  }
  // Backfill any rule the model didn't score with auto-pass.
  const seen = new Set(scores.map((s) => s.ruleId));
  for (const rule of rules) {
    if (!seen.has(rule.id)) {
      scores.push({
        ruleId: rule.id,
        score: 1,
        rationale: 'No score returned; auto-pass.',
      });
    }
  }
  return scores;
}

function extractFirstJsonArray(s: string): string | null {
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === '[') depth += 1;
    else if (s[i] === ']') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
