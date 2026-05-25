/**
 * Any-language conversational tenant support.
 *
 * Tenant speaks/types in ANY language (auto-detected via LLM). Response is
 * in the tenant's detected language, falling back to English if unknown.
 * Every turn persisted to `polyglot_conversations` with ISO-639 codes.
 *
 * WHY AI-NATIVE: beyond rigid en/sw toggle — supports arbitrary incoming
 * language. A human support team can't staff every language; an LLM can.
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
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolyglotTurn {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly threadId: string;
  readonly turnIndex: number;
  readonly speaker: 'user' | 'assistant' | 'system';
  readonly detectedLanguage: string | null;
  readonly responseLanguage: string | null;
  readonly text: string;
  readonly translationEn: string | null;
  readonly modelVersion: string | null;
  readonly promptHash: string | null;
  readonly confidence: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface PolyglotInput {
  readonly tenantId: string;
  readonly customerId?: string | null;
  readonly threadId: string;
  readonly text: string;
  /** Optional context (prior turns); if omitted, repo is queried. */
  readonly historyText?: string;
}

export interface PolyglotReply {
  readonly userTurn: PolyglotTurn;
  readonly assistantTurn: PolyglotTurn;
}

export interface PolyglotRepository {
  insertTurn(turn: PolyglotTurn): Promise<PolyglotTurn>;
  nextTurnIndex(tenantId: string, threadId: string): Promise<number>;
  listThread(
    tenantId: string,
    threadId: string,
  ): Promise<readonly PolyglotTurn[]>;
}

export interface PolyglotDeps {
  readonly repo: PolyglotRepository;
  readonly llm?: ClassifyLLMPort;
  readonly budgetGuard?: BudgetGuard;
  readonly fallbackLanguage?: string; // default 'en'
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Prompts — NEVER hardcoded en/sw. LLM detects + responds.
// ---------------------------------------------------------------------------

const DETECT_SYSTEM_PROMPT = `You are a language-detection + property-management assistant.
Detect the user's language (ISO-639-1/-2), then answer in THAT language.
Return ONLY JSON:
{
  "detectedLanguage": string,
  "responseLanguage": string,
  "reply": string,
  "translationEn": string,
  "confidence": number (0..1)
}
Rules:
- If you are unsure of the language, set responseLanguage to "en" and answer in English.
- translationEn MUST be an English version of your reply (for audit).
- Be concise and professional; this is property-management support.`;

function userPrompt(
  userText: string,
  history: string,
): string {
  return `Conversation so far:\n${history || '(none)'}\n\nUser: ${userText}\n\nRespond.`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PolyglotSupport {
  reply(input: PolyglotInput): Promise<PolyglotReply>;
  listThread(
    tenantId: string,
    threadId: string,
  ): Promise<readonly PolyglotTurn[]>;
}

export function createPolyglotSupport(deps: PolyglotDeps): PolyglotSupport {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;
  const fallback = deps.fallbackLanguage ?? 'en';

  return {
    async reply(input) {
      if (!input.tenantId || !input.threadId || !input.text) {
        throw new Error('polyglot-support.reply: missing required fields');
      }

      const history =
        input.historyText ??
        (await deps.repo.listThread(input.tenantId, input.threadId))
          .map((t) => `${t.speaker}: ${t.text}`)
          .join('\n');

      const userIndex = await deps.repo.nextTurnIndex(input.tenantId, input.threadId);
      const nowIso = now().toISOString();

      const system = DETECT_SYSTEM_PROMPT;
      const user = userPrompt(input.text, history);
      const hash = promptHash(system + '\n---\n' + user);

      // Always persist the user turn first so we never lose the inbound message
      const userTurn: PolyglotTurn = {
        id: newId('pgt'),
        tenantId: input.tenantId,
        customerId: input.customerId ?? null,
        threadId: input.threadId,
        turnIndex: userIndex,
        speaker: 'user',
        detectedLanguage: null,
        responseLanguage: null,
        text: input.text,
        translationEn: null,
        modelVersion: null,
        promptHash: hash,
        confidence: null,
        metadata: {},
        createdAt: nowIso,
      };
      const storedUser = await deps.repo.insertTurn(userTurn);

      if (!deps.llm) {
        const assistantTurn: PolyglotTurn = {
          id: newId('pgt'),
          tenantId: input.tenantId,
          customerId: input.customerId ?? null,
          threadId: input.threadId,
          turnIndex: userIndex + 1,
          speaker: 'assistant',
          detectedLanguage: null,
          responseLanguage: fallback,
          text: 'Sorry — polyglot assistant is currently unavailable. A human will follow up shortly.',
          translationEn:
            'Sorry — polyglot assistant is currently unavailable. A human will follow up shortly.',
          modelVersion: DEGRADED_MODEL_VERSION,
          promptHash: hash,
          confidence: null,
          metadata: { degraded: true },
          createdAt: nowIso,
        };
        const storedAssistant = await deps.repo.insertTurn(assistantTurn);
        return { userTurn: storedUser, assistantTurn: storedAssistant };
      }

      await guard(input.tenantId, 'polyglot-support:reply');

      try {
        const res = await deps.llm.classify({ systemPrompt: system, userPrompt: user });
        const parsed =
          safeJsonParse<{
            detectedLanguage?: string;
            responseLanguage?: string;
            reply?: string;
            translationEn?: string;
            confidence?: number;
          }>(res.raw) ?? {};

        const assistantTurn: PolyglotTurn = {
          id: newId('pgt'),
          tenantId: input.tenantId,
          customerId: input.customerId ?? null,
          threadId: input.threadId,
          turnIndex: userIndex + 1,
          speaker: 'assistant',
          detectedLanguage: parsed.detectedLanguage ?? null,
          responseLanguage: parsed.responseLanguage ?? fallback,
          text: parsed.reply ?? 'I am unable to respond right now.',
          translationEn: parsed.translationEn ?? parsed.reply ?? null,
          modelVersion: res.modelVersion,
          promptHash: hash,
          confidence: parsed.confidence == null ? null : clamp01(parsed.confidence),
          metadata: {},
          createdAt: nowIso,
        };
        const storedAssistant = await deps.repo.insertTurn(assistantTurn);
        return { userTurn: storedUser, assistantTurn: storedAssistant };
      } catch (err) {
        const assistantTurn: PolyglotTurn = {
          id: newId('pgt'),
          tenantId: input.tenantId,
          customerId: input.customerId ?? null,
          threadId: input.threadId,
          turnIndex: userIndex + 1,
          speaker: 'assistant',
          detectedLanguage: null,
          responseLanguage: fallback,
          text: 'System error; please retry.',
          translationEn: 'System error; please retry.',
          modelVersion: DEGRADED_MODEL_VERSION,
          promptHash: hash,
          confidence: null,
          metadata: { degraded: true, error: err instanceof Error ? err.message : String(err) },
          createdAt: nowIso,
        };
        const storedAssistant = await deps.repo.insertTurn(assistantTurn);
        return { userTurn: storedUser, assistantTurn: storedAssistant };
      }
    },

    async listThread(tenantId, threadId) {
      return deps.repo.listThread(tenantId, threadId);
    },
  };
}
