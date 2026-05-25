/**
 * Continuous portfolio-wide sentiment monitor.
 *
 * Consumes every `messages` / `complaints` / `feedback` row as it lands and
 * classifies sentiment + emotion + churn-signal + liability-signal +
 * fraud-signal. Rows stream into `ai_native_signals`. When a tenant's
 * rolling sentiment crosses a threshold, emits `TenantSentimentShift`.
 *
 * WHY AI-NATIVE (vs human-playbook):
 *   Humans cannot read 10,000 messages/day across a portfolio. This does
 *   it in real time, continuously, every inbound communication.
 */

import {
  type BudgetGuard,
  type ClassifyLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  newId,
  clamp01,
  clampBipolar,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SentimentSourceType =
  | 'message'
  | 'complaint'
  | 'feedback'
  | 'inspection_note'
  | 'case_note'
  | 'other';

export interface SentimentInput {
  readonly tenantId: string;
  readonly customerId?: string | null;
  readonly sourceType: SentimentSourceType;
  readonly sourceId: string;
  readonly text: string;
  readonly languageHint?: string | null;
}

export interface SentimentSignal {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly sourceType: SentimentSourceType;
  readonly sourceId: string;
  readonly languageCode: string | null;
  readonly sentimentScore: number; // [-1, 1]
  readonly emotionLabel: string | null;
  readonly churnSignal: number; // [0, 1]
  readonly liabilitySignal: number; // [0, 1]
  readonly fraudSignal: number; // [0, 1]
  readonly rawExcerpt: string;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly confidence: number | null;
  readonly explanation: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

export interface SentimentShiftEvent {
  readonly type: 'TenantSentimentShift';
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly previousAvg: number;
  readonly currentAvg: number;
  readonly windowHours: number;
  readonly sampleCount: number;
  readonly observedAt: string;
}

export interface SentimentRollup {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly windowHours: number;
  readonly avgSentiment: number;
  readonly sampleCount: number;
  readonly observedAt: string;
}

export interface SentimentMonitorRepository {
  insertSignal(signal: SentimentSignal): Promise<SentimentSignal>;
  getRollingAverage(
    tenantId: string,
    customerId: string | null,
    windowHours: number,
  ): Promise<{ avg: number; count: number } | null>;
  upsertRollup(rollup: SentimentRollup): Promise<SentimentRollup>;
  listRecent(
    tenantId: string,
    params: { since?: string; limit?: number; customerId?: string | null },
  ): Promise<readonly SentimentSignal[]>;
}

export interface SentimentEventPublisher {
  publishShift(event: SentimentShiftEvent): Promise<void>;
}

export interface SentimentMonitorDeps {
  readonly repo: SentimentMonitorRepository;
  readonly llm?: ClassifyLLMPort;
  readonly publisher?: SentimentEventPublisher;
  readonly budgetGuard?: BudgetGuard;
  readonly shiftThreshold?: number; // default 0.3 absolute delta
  readonly windowHours?: number; // default 168 (7 days)
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Prompts (global-first — no hardcoded language)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a multilingual sentiment + risk classifier for a property-management platform.
Detect the language (ISO-639-1/-2 code). Classify the text across five dimensions.
Return ONLY JSON matching this schema:
{
  "languageCode": string,
  "sentimentScore": number (between -1 and 1),
  "emotionLabel": string (one of: anger, joy, sadness, frustration, fear, neutral, mixed),
  "churnSignal": number (0..1 — probability the writer will leave),
  "liabilitySignal": number (0..1 — probability of legal / liability exposure),
  "fraudSignal": number (0..1 — probability of fraud / misrepresentation),
  "confidence": number (0..1),
  "explanation": string (one sentence, language-agnostic)
}`;

function userPrompt(input: SentimentInput): string {
  const hint = input.languageHint ? `(hint: ${input.languageHint})` : '';
  return `Classify this ${input.sourceType} ${hint}:\n"""\n${input.text}\n"""`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SentimentMonitor {
  /** Classify a single message; persist signal; emit shift event if crossed. */
  ingest(input: SentimentInput): Promise<SentimentSignal>;
  /** Batch-classify in order. */
  ingestBatch(
    inputs: readonly SentimentInput[],
  ): Promise<readonly SentimentSignal[]>;
  listRecent(
    tenantId: string,
    params?: { since?: string; limit?: number; customerId?: string | null },
  ): Promise<readonly SentimentSignal[]>;
}

export function createSentimentMonitor(
  deps: SentimentMonitorDeps,
): SentimentMonitor {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;
  const threshold = deps.shiftThreshold ?? 0.3;
  const windowHours = deps.windowHours ?? 168;

  async function classifyOne(
    input: SentimentInput,
  ): Promise<SentimentSignal> {
    const system = SYSTEM_PROMPT;
    const user = userPrompt(input);
    const hash = promptHash(system + '\n---\n' + user);
    const observedAt = now().toISOString();

    if (!deps.llm) {
      return {
        id: newId('ains'),
        tenantId: input.tenantId,
        customerId: input.customerId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        languageCode: input.languageHint ?? null,
        sentimentScore: 0,
        emotionLabel: null,
        churnSignal: 0,
        liabilitySignal: 0,
        fraudSignal: 0,
        rawExcerpt: input.text.slice(0, 500),
        modelVersion: DEGRADED_MODEL_VERSION,
        promptHash: hash,
        confidence: null,
        explanation: 'LLM port unavailable; degraded pass-through',
        metadata: { degraded: true },
        observedAt,
      };
    }

    await guard(input.tenantId, 'sentiment-monitor:classify');

    try {
      const res = await deps.llm.classify({
        systemPrompt: system,
        userPrompt: user,
      });
      const parsed =
        safeJsonParse<{
          languageCode?: string;
          sentimentScore?: number;
          emotionLabel?: string;
          churnSignal?: number;
          liabilitySignal?: number;
          fraudSignal?: number;
          confidence?: number;
          explanation?: string;
        }>(res.raw) ?? {};

      return {
        id: newId('ains'),
        tenantId: input.tenantId,
        customerId: input.customerId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        languageCode: parsed.languageCode ?? input.languageHint ?? null,
        sentimentScore: clampBipolar(parsed.sentimentScore),
        emotionLabel: parsed.emotionLabel ?? null,
        churnSignal: clamp01(parsed.churnSignal),
        liabilitySignal: clamp01(parsed.liabilitySignal),
        fraudSignal: clamp01(parsed.fraudSignal),
        rawExcerpt: input.text.slice(0, 500),
        modelVersion: res.modelVersion,
        promptHash: hash,
        confidence: parsed.confidence == null ? null : clamp01(parsed.confidence),
        explanation: parsed.explanation ?? null,
        metadata: {},
        observedAt,
      };
    } catch (err) {
      // LLM failed — fall back to degraded, still persist so the audit
      // trail shows the attempt. The next retry can upsert a cleaner row.
      return {
        id: newId('ains'),
        tenantId: input.tenantId,
        customerId: input.customerId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        languageCode: input.languageHint ?? null,
        sentimentScore: 0,
        emotionLabel: null,
        churnSignal: 0,
        liabilitySignal: 0,
        fraudSignal: 0,
        rawExcerpt: input.text.slice(0, 500),
        modelVersion: DEGRADED_MODEL_VERSION,
        promptHash: hash,
        confidence: null,
        explanation: `LLM call failed: ${err instanceof Error ? err.message : 'unknown'}`,
        metadata: { degraded: true, error: true },
        observedAt,
      };
    }
  }

  async function maybeEmitShift(
    signal: SentimentSignal,
  ): Promise<void> {
    if (!deps.publisher) return;
    const rolling = await deps.repo.getRollingAverage(
      signal.tenantId,
      signal.customerId,
      windowHours,
    );
    if (!rolling || rolling.count < 5) return;
    const delta = Math.abs(signal.sentimentScore - rolling.avg);
    if (delta >= threshold) {
      await deps.publisher.publishShift({
        type: 'TenantSentimentShift',
        tenantId: signal.tenantId,
        customerId: signal.customerId,
        previousAvg: rolling.avg,
        currentAvg: signal.sentimentScore,
        windowHours,
        sampleCount: rolling.count,
        observedAt: signal.observedAt,
      });
    }
  }

  return {
    async ingest(input) {
      if (!input.tenantId || !input.sourceId || !input.text) {
        throw new Error('sentiment-monitor.ingest: missing required fields');
      }
      const classified = await classifyOne(input);
      const stored = await deps.repo.insertSignal(classified);
      await maybeEmitShift(stored);
      return stored;
    },

    async ingestBatch(inputs) {
      const results: SentimentSignal[] = [];
      for (const input of inputs) {
        results.push(await this.ingest(input));
      }
      return results;
    },

    async listRecent(tenantId, params) {
      if (!tenantId) throw new Error('tenantId required');
      return deps.repo.listRecent(tenantId, params ?? {});
    },
  };
}
