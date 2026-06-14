/**
 * KI-005 — chat-orchestrator Auditor verdict surfacing.
 *
 * The non-stream brain.hono.ts path already runs `auditChatResponse` to
 * enforce the CLAUDE.md evidence-required hard rule (it WITHHOLDS ungrounded
 * JSON answers). A stream cannot un-send tokens already flushed, so on the
 * mining /chat SSE surface the orchestrator instead SURFACES the verdict as a
 * terminal `auditor` event — the grounding signal is never silently dropped.
 *
 * This test drives `runChatOrchestrator` through the Master-Brain path
 * (orchestrator routing OFF) with every heavy dependency mocked at the module
 * boundary, and asserts:
 *
 *   1. an `auditor` event is yielded for the turn,
 *   2. it carries the verdict returned by the (mocked) `auditChatResponse`
 *      over the FINAL answer text,
 *   3. it is the LAST event before `done` (after the final `message_chunk`).
 *
 * Mirrors the codebase's "test the pure bridge, mock the heavy deps" idiom
 * (see consolidation-runner.test.ts for the vi.mock module-boundary pattern).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocked heavy dependencies (module boundary) ─────────────────────

// The Master-Brain junior fan-out + lens router. We give a deterministic
// brain output (single-line answer + empty dispatch plan so no juniors run)
// and a no-op executor.
vi.mock('@borjie/ai-copilot', () => ({
  // BorjieConfigError must be a real class (the orchestrator does
  // `instanceof BorjieConfigError`).
  BorjieConfigError: class BorjieConfigError extends Error {},
  classifyLenses: () => ({
    lenses: ['strategist'],
    directive: 'be precise',
    derivedMode: 'strategist',
    primary: 'strategist',
  }),
  createDefaultMasterBrainAgent: () => ({
    processInput: async () => ({
      one_line_answer: 'Royalty filing is due in 3 days. [evidence:corpus:reg_1]',
      dispatch_plan: [],
      evidence_ids: ['corpus:reg_1'],
      confidence: 0.8,
    }),
  }),
  // No juniors in the plan → resolves to an empty result set immediately.
  executeJuniors: async () => [],
  lazyClaudeClient: () => ({ complete: async () => '' }),
}));

vi.mock('@borjie/document-ai', () => ({
  createPiiTokeniser: () => ({ tokenise: (s: string) => s }),
}));

// The corpus read runs inside `withTenantContext`; we just run the callback
// with a dummy tx so the retrieval block does not touch a real DB.
vi.mock('@borjie/database', () => ({
  withTenantContext: async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({}),
}));

vi.mock('../chat-corpus-evidence', () => ({
  CORPUS_TOPK_DEFAULT: 5,
  embedQueryViaOpenAI: async () => new Array(8).fill(0),
  searchCorpusTopK: async () => [],
}));

vi.mock('../graph-rag-expand', () => ({
  expandGraphEvidence: async () => [],
}));

// Conformal calibration is a pass-through here (returns the raw confidence).
vi.mock('../../../composition/conformal/chat-conformal-confidence', () => ({
  applyChatConformalConfidence: async ({ rawConfidence }: { rawConfidence: number }) => ({
    confidence: rawConfidence,
  }),
}));

// Force the Master-Brain path (orchestrator main-loop OFF) so the test is
// deterministic and does not construct a SovereignBrain.
vi.mock('../../../composition/brain-orchestrator-turn', () => ({
  resolveBrainOrchestratorRoutingEnabled: () => false,
}));

// The Auditor gate — return a deterministic ungrounded verdict so we can
// assert the surfaced fields. `auditChatResponse` is captured as a spy so we
// can also assert it ran over the FINAL answer text. Declared via
// `vi.hoisted` so the spy exists before the hoisted `vi.mock` factory runs.
const { auditChatResponse } = vi.hoisted(() => ({
  auditChatResponse: vi.fn(async () => ({
    verdict: 'reject' as const,
    evidenceCount: 0,
    evidenceIds: [] as string[],
    auditLogId: 'audit_test_1',
    evidenceWarning: 'no_evidence_cited' as const,
    latencyMs: 1,
    invalidEvidenceIds: [] as string[],
    groundingFault: false,
    violation: true,
    ethics: {} as never,
  })),
}));
vi.mock('../../../composition/chat-response-gate', () => ({
  auditChatResponse,
}));

// ─── System under test (imported AFTER the mocks) ────────────────────

import { runChatOrchestrator, type ChatSseEvent } from '../chat-orchestrator';

async function collect(
  gen: AsyncGenerator<ChatSseEvent, void, unknown>,
): Promise<ChatSseEvent[]> {
  const out: ChatSseEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('runChatOrchestrator — KI-005 auditor verdict surfacing', () => {
  beforeEach(() => {
    auditChatResponse.mockClear();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('emits an auditor event after the final message_chunk and before done', async () => {
    const events = await collect(
      runChatOrchestrator({
        tenantId: 'tnt_estate_1',
        userId: 'usr_1',
        language: 'en',
        message: 'When is the royalty filing due?',
        sessionId: 'thr_1',
        db: {},
      }),
    );

    const types = events.map((e) => e.type);
    // The terminal ordering: message_chunk … auditor … done.
    const chunkIdx = types.indexOf('message_chunk');
    const auditorIdx = types.indexOf('auditor');
    const doneIdx = types.indexOf('done');

    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(auditorIdx).toBeGreaterThan(chunkIdx);
    expect(doneIdx).toBeGreaterThan(auditorIdx);
    // The auditor verdict is the LAST event before `done`.
    expect(auditorIdx).toBe(doneIdx - 1);

    const auditorEvt = events[auditorIdx];
    expect(auditorEvt).toEqual({
      type: 'auditor',
      verdict: 'reject',
      evidenceCount: 0,
      evidenceWarning: 'no_evidence_cited',
      groundingFault: false,
    });
  });

  it('audits the FINAL answer text (the same span shipped to the client)', async () => {
    await collect(
      runChatOrchestrator({
        tenantId: 'tnt_estate_1',
        userId: 'usr_1',
        language: 'en',
        message: 'When is the royalty filing due?',
        sessionId: 'thr_1',
        db: {},
      }),
    );

    expect(auditChatResponse).toHaveBeenCalledTimes(1);
    const arg = auditChatResponse.mock.calls[0][0] as {
      responseText: string;
      tenantId: string;
      threadId: string | null;
      personaId: string;
    };
    expect(arg.responseText).toBe(
      'Royalty filing is due in 3 days. [evidence:corpus:reg_1]',
    );
    expect(arg.tenantId).toBe('tnt_estate_1');
    expect(arg.threadId).toBe('thr_1');
    expect(arg.personaId).toBe('mr-mwikila-head');
  });

  it('never crashes the turn when the auditor gate throws (fail-safe)', async () => {
    auditChatResponse.mockRejectedValueOnce(new Error('gate boom'));
    const events = await collect(
      runChatOrchestrator({
        tenantId: 'tnt_estate_1',
        userId: 'usr_1',
        language: 'en',
        message: 'When is the royalty filing due?',
        sessionId: 'thr_1',
        db: {},
      }),
    );
    const types = events.map((e) => e.type);
    // No auditor event on a gate fault, but the turn still completes cleanly.
    expect(types).toContain('message_chunk');
    expect(types).toContain('done');
    expect(types).not.toContain('auditor');
  });
});
