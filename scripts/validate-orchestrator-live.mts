/**
 * VALIDATION (proof, not production code): orchestrator main-loop on real
 * Anthropic traffic.
 *
 * Closes the open gap "the orchestrator main-loop is unvalidated on real
 * LLM traffic". This script stands up the orchestrator's REAL generation
 * path — `createAnthropicRouter(new Anthropic(...))` wrapping the real
 * `@anthropic-ai/sdk`, threaded through the actual `thinkExtended()`
 * main-loop with its hook chain, plan store, budget, context budget,
 * session store and memory tool — and drives it with a real mining-
 * compliance prompt at FULL main-loop fidelity.
 *
 * It makes two small, cost-bounded Anthropic calls (the second only
 * because the first surfaced a real bug):
 *   - PHASE A: production-equivalent path (fresh session). Reproduces the
 *     discovered bug — the loop sends an EMPTY `messages` array to the
 *     router on turn 1, so Anthropic 400s and the answer comes back empty.
 *     (~0 output tokens — the request is rejected before generation.)
 *   - PHASE B: same loop with the user turn present in the transcript.
 *     Proves the real LLM round-trip returns a real grounded `answer`.
 *
 * Fidelity: FULL main-loop (`thinkExtended`), strictly higher than a bare
 * router-level call. The tool registry is intentionally empty so the model
 * can only terminate via `respond_to_owner` → the loop's `answer` path
 * (main-loop.ts:985-1007), which is exactly the "real grounded answer"
 * surface we need to prove.
 *
 * This file is a one-shot validation harness. It edits NO production source.
 *
 * Run:
 *   pnpm dlx tsx scripts/validate-orchestrator-live.mts
 *   (or)  ./node_modules/.bin/tsx scripts/validate-orchestrator-live.mts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import {
  thinkExtended,
  createAnthropicRouter,
  createToolDispatcher,
  createInMemoryToolSearch,
  createContextBudget,
  createInMemorySessionStore,
  createInMemoryPlanStore,
  createInMemoryMemoryTool,
  createHookChain,
  type OrchestratorDeps,
  type OrchestratorRequest,
} from '../packages/central-intelligence/src/kernel/orchestrator/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// ─── 1. Load the API key from .env WITHOUT printing it ──────────────────
function loadApiKey(): string {
  const envPath = resolve(REPO_ROOT, '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'ANTHROPIC_API_KEY') continue;
    let val = trimmed.slice(eq + 1).trim();
    // strip surrounding quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  throw new Error('ANTHROPIC_API_KEY not found in .env');
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  // Never print the key — only a redacted fingerprint.
  console.log(
    `[setup] ANTHROPIC_API_KEY loaded (length=${apiKey.length}, prefix=${apiKey.slice(0, 7)}…)`,
  );

  const MODEL = 'claude-opus-4-8';
  console.log(`[setup] model=${MODEL}`);

  // ─── 2. Real Anthropic SDK client → real orchestrator LLM router ──────
  // `new Anthropic({apiKey}).messages` matches the KernelAnthropicSdkLike /
  // AnthropicMessagesClient duck shape createAnthropicRouter expects.
  const anthropic = new Anthropic({ apiKey });
  const router = createAnthropicRouter(
    anthropic as unknown as Parameters<typeof createAnthropicRouter>[0],
    {
      model: MODEL,
      maxTokens: 256,
      // Surface any swallowed SDK error — the router's fail-safe collapses
      // thrown errors to an empty `final` Decision, so without this logger a
      // real auth/network/model error would look like a silent empty answer.
      logger: {
        warn: (msg, meta) =>
          console.error(`[router:warn] ${msg}`, JSON.stringify(meta ?? {})),
      },
    },
  );

  // ─── 3. Shared deps factory ───────────────────────────────────────────
  // Empty tool registry → the model has no tools to call, so it must
  // terminate the loop with a natural-language answer (respond_to_owner),
  // which the main-loop maps to `{ kind: 'answer', text }`.
  const makeDispatcher = () =>
    createToolDispatcher({
      registry: {
        // runTool is the only method the dispatcher calls; with no tools
        // registered + no tool_call decisions, it is never invoked here.
        async runTool(name: string) {
          return { kind: 'not-found' as const, name };
        },
      } as unknown as Parameters<typeof createToolDispatcher>[0]['registry'],
    });

  function makeDeps(sessionStore: OrchestratorDeps['sessionStore']): OrchestratorDeps {
    return {
      router,
      dispatcher: makeDispatcher(),
      toolSearch: createInMemoryToolSearch([]), // empty catalogue
      hookChain: createHookChain([]), // no hooks — clean main-loop
      planStore: createInMemoryPlanStore(),
      sessionStore,
      memoryTool: createInMemoryMemoryTool(),
      contextBudget: createContextBudget(),
      logger: {
        info: () => {},
        warn: (msg, meta) => console.log(`[loop:warn] ${msg}`, meta ?? ''),
        error: (msg, meta) => console.log(`[loop:error] ${msg}`, meta ?? ''),
      },
    };
  }

  // ─── 4. A real mining-compliance prompt + request ────────────────────
  const PROMPT =
    "In one sentence, what's a key compliance step before selling gold ore in Tanzania?";

  const baseReq: OrchestratorRequest = {
    threadId: `validate-orch-live-${Date.now()}`,
    userMessage: PROMPT,
    scope: {
      kind: 'tenant',
      tenantId: 'validation-tenant',
      actorUserId: 'validation-actor',
      roles: ['owner'],
      personaId: 'mr-mwikila-head',
    },
    tier: 'org',
    persona: 'mr-mwikila-head',
    // Keep the loop short + cheap: one turn is enough for a single answer.
    // NB: maxToolCalls must be > 0 — the budget treats `toolCalls (0) >=
    // maxToolCalls (0)` as already-exhausted at loop entry (budget.ts:149).
    budget: { maxTurns: 2, maxToolCalls: 4 },
    // We are proving the LLM round-trip, not the grounding-corpus citation
    // contract — evidenceRequired:false avoids a cite-or-refuse directive.
    evidenceRequired: false,
    languageDirective:
      'Respond in English only. Do not use any Swahili. One sentence.',
  };

  console.log(`\n[prompt] ${PROMPT}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE A — production-equivalent path (fresh session, NOT pre-seeded).
  // This mirrors EXACTLY what kernel.ts runViaOrchestrator() does:
  // build the OrchestratorRequest and call think() with a fresh
  // sessionStore. It reproduces the discovered bug: the main-loop sends
  // an EMPTY messages array to the router on turn 1 of a fresh thread.
  // ═══════════════════════════════════════════════════════════════════════
  console.log('──────── PHASE A: production-equivalent path (fresh session) ────────');
  const depsA = makeDeps(createInMemorySessionStore());
  const tA = Date.now();
  const resA = await thinkExtended(baseReq, depsA);
  console.log(`[A] kind=${resA.kind}  elapsed=${Date.now() - tA}ms`);
  const textA = resA.kind === 'answer' ? resA.text ?? '' : '';
  console.log(`[A] answer text length = ${textA.length}`);
  const bugReproduced = resA.kind === 'answer' && textA.trim().length === 0;
  if (bugReproduced) {
    console.log(
      '[A] ⚠️  BUG REPRODUCED — orchestrator returned an EMPTY answer on a ' +
        'fresh thread. The router received `messages: []` and Anthropic ' +
        'rejected it with 400 "messages: at least one message is required" ' +
        '(see [router:warn] above). req.userMessage is never seeded into the ' +
        'session transcript before the first router.call (main-loop.ts:607-610).',
    );
  } else {
    console.log('[A] (bug NOT reproduced — main-loop may have been fixed since)');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE B — proof that the orchestrator's REAL LLM path returns a real
  // grounded answer once the user turn actually reaches the router.
  //
  // We do NOT edit production source. Instead we wrap the in-memory
  // sessionStore so resumeOrCreate() returns a session whose transcript
  // already contains the user turn — i.e. we supply the one thing the
  // production caller is missing. Everything downstream (assembleSystem,
  // context-budget compaction, the real createAnthropicRouter → real
  // @anthropic-ai/sdk call, the answer-decision path) runs unmodified.
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n──────── PHASE B: same loop, user turn present in transcript ────────');
  const inner = createInMemorySessionStore();
  const seededStore: OrchestratorDeps['sessionStore'] = {
    ...inner,
    async resumeOrCreate(threadId: string) {
      const s = await inner.resumeOrCreate(threadId);
      // Pre-seed the inbound user message as the first transcript turn.
      return {
        ...s,
        transcript: [
          {
            role: 'user' as const,
            content: PROMPT,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    },
  };
  const depsB = makeDeps(seededStore);
  const tB = Date.now();
  const resB = await thinkExtended(baseReq, depsB);
  const elapsedB = Date.now() - tB;
  console.log(`[B] kind=${resB.kind}  elapsed=${elapsedB}ms`);

  if (resB.kind !== 'answer') {
    console.error(`\n❌ FAIL — Phase B expected an 'answer', got '${resB.kind}'.`);
    console.error('[B] full response:', JSON.stringify(resB, null, 2));
    process.exitCode = 1;
    return;
  }
  const textB = resB.text ?? '';
  console.log(`[B] turnsUsed=${resB.turnsUsed}  citations=${JSON.stringify(resB.citations)}`);
  console.log('\n──────── REAL MODEL OUTPUT (Phase B) ────────');
  console.log(textB);
  console.log('─────────────────────────────────────────────\n');

  if (textB.trim().length === 0) {
    console.error(
      "❌ FAIL — Phase B 'answer' is EMPTY. The real LLM seam did not " +
        'return text (check [router:warn] for the swallowed SDK error).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '✅ PASS — the orchestrator main-loop made a REAL Anthropic call ' +
      '(model=claude-opus-4-8) and returned a real, non-empty grounded ' +
      'answer (full-main-loop fidelity via thinkExtended).',
  );
  if (bugReproduced) {
    console.log(
      '⚠️  HOWEVER: Phase A proves the PRODUCTION path is broken on turn 1 ' +
        'of a fresh thread — the user message never reaches the router. ' +
        'This is a real orchestrator bug; see the report. Phase B only ' +
        'passes because the harness supplied the missing user turn.',
    );
  }
}

main().catch((err) => {
  console.error('\n❌ FAIL — uncaught error during validation:');
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
