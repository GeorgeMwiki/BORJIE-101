/**
 * aop-wiring.test.ts — locks the R8 un-darking contract:
 *
 *   1. composition emits the boot-proof signal (the organ going dark
 *      again is detectable);
 *   2. a full OBSERVE→PROPOSE→REGRESSION→CANARY tick runs against
 *      in-memory fakes: candidate enrols at shadow, passes regression,
 *      climbs ONE rung per tick, and only reaches `live` (active-version
 *      flip persisted to the store) after the full gated ladder;
 *   3. the propose-only rail holds: a failing regression NEVER promotes
 *      and NEVER flips the active version; a null executor (no Anthropic
 *      key) HOLDS the candidate fail-closed;
 *   4. quality drift on a climbing candidate demotes one rung;
 *   5. an error tick (store fault / executor fault) resolves without
 *      throwing — the loop is fail-safe;
 *   6. the kill-switch / test-env gate keeps start() inert.
 */

import { describe, expect, it } from 'vitest';

import {
  AOP_META_LOOP_KILL_SWITCH_ENV,
  createAnthropicAopExecutor,
  createAopMetaLoopCron,
  createInProcessCanaryAdapter,
  deriveCandidates,
  type AopAnthropicClientLike,
} from '../aop-wiring';
import {
  createAOPRegistry,
  createInMemoryAOPRegistryStore,
  type AOPExecutor,
  type AOPRegistryStore,
} from '@borjie/central-intelligence/aops';
import type { PinoLikeLogger } from '../../utils/pino-shim';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface LogRecord {
  readonly level: 'info' | 'warn' | 'error';
  readonly meta: Record<string, unknown>;
  readonly msg: string;
}

function fakeLogger(): PinoLikeLogger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const push =
    (level: LogRecord['level']) =>
    (meta: object, msg?: string): void => {
      records.push({ level, meta: meta as Record<string, unknown>, msg: msg ?? '' });
    };
  return { records, info: push('info'), warn: push('warn'), error: push('error') };
}

const AOP_ID = 'royalty-triage';
const SET_ID = 'royalty-triage-set';

function specOf(version: string): Record<string, unknown> {
  return {
    id: AOP_ID,
    version,
    systemPrompt: 'You are the royalty triage operating procedure.',
    tools: [],
    model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
    regressionSetId: SET_ID,
    ownedBy: 'platform',
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

const REGRESSION_SET = {
  id: SET_ID,
  transcripts: [
    {
      id: 't1',
      userMessage: 'Which buyers are in arrears?',
      expectedAnswerSubstring: 'arrears',
      expectedSignals: [],
    },
    {
      id: 't2',
      userMessage: 'Summarise royalty exposure for the estate.',
      expectedSignals: ['royalty'],
    },
  ],
};

/** Store pre-seeded with v1 (active) + v2 (candidate) + the regression set. */
async function seededStore(): Promise<AOPRegistryStore> {
  const store = createInMemoryAOPRegistryStore();
  await store.putRegressionSet(REGRESSION_SET as never);
  await store.putSpec(specOf('1') as never);
  await store.putSpec(specOf('2') as never);
  await store.putActiveVersion(AOP_ID, '1');
  return store;
}

/** Executor whose pass/fail behaviour is switchable mid-test (drift). */
function switchableExecutor(): AOPExecutor & { setMode(mode: 'pass' | 'fail'): void } {
  let mode: 'pass' | 'fail' = 'pass';
  return {
    setMode(next) {
      mode = next;
    },
    async execute() {
      const finalOutput =
        mode === 'pass'
          ? 'Buyers in arrears: B-7, B-12. Total royalty exposure: TZS 4.2M.'
          : 'I do not know.';
      return Object.freeze({ finalOutput, toolCalls: Object.freeze([]) });
    },
  };
}

async function activeVersionsOf(
  store: AOPRegistryStore,
): Promise<ReadonlyArray<{ readonly id: string; readonly version: string }>> {
  return store.listActiveVersions();
}

// ---------------------------------------------------------------------------
// Boot-proof signal
// ---------------------------------------------------------------------------

describe('createAopMetaLoopCron — composition signal', () => {
  it('emits the structured boot-proof log line at composition time', async () => {
    const logger = fakeLogger();
    createAopMetaLoopCron({
      store: await seededStore(),
      executor: switchableExecutor(),
      logger,
      enabled: false,
    });
    const boot = logger.records.find(
      (r) => r.level === 'info' && r.msg.includes('meta-learning loop composed'),
    );
    expect(boot).toBeDefined();
    expect(boot?.meta.wiring).toBe('aop-meta-loop');
    expect(boot?.meta.executorWired).toBe(true);
    expect(boot?.meta.killSwitchEnvFlag).toBe(AOP_META_LOOP_KILL_SWITCH_ENV);
  });

  it('reports executorWired=false honestly when no Anthropic key is configured', async () => {
    const logger = fakeLogger();
    createAopMetaLoopCron({
      store: await seededStore(),
      executor: null,
      logger,
      enabled: false,
    });
    const boot = logger.records.find((r) => r.msg.includes('meta-learning loop composed'));
    expect(boot?.meta.executorWired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The full gated ladder
// ---------------------------------------------------------------------------

describe('aop meta-loop — OBSERVE → PROPOSE → REGRESSION → CANARY', () => {
  it('walks a passing candidate ONE rung per tick and activates only at live', async () => {
    const store = await seededStore();
    const adapter = createInProcessCanaryAdapter();
    const cron = createAopMetaLoopCron({
      store,
      executor: switchableExecutor(),
      adapter,
      logger: fakeLogger(),
      enabled: false,
    });

    // Tick 1 — PROPOSE (enrol at shadow) + first regression pass → 1pct.
    const t1 = await cron.tickOnce();
    expect(t1.aopsSeen).toBe(1);
    expect(t1.candidates).toBe(1);
    expect(t1.enrolled).toBe(1);
    expect(t1.regressionsRun).toBe(1);
    expect(t1.promoted).toBe(1);
    expect(t1.activated).toBe(0);
    expect(t1.errored).toBe(0);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('canary-1pct');
    // Mid-ladder: the active version has NOT flipped (propose-only rail).
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '1' }]);

    // Ticks 2 + 3 — one rung each, every rung gated by a FRESH regression.
    const t2 = await cron.tickOnce();
    expect(t2.enrolled).toBe(0); // never re-enrolled (progress not reset)
    expect(t2.promoted).toBe(1);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('canary-5pct');
    const t3 = await cron.tickOnce();
    expect(t3.promoted).toBe(1);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('canary-25pct');

    // Tick 4 — final rung: ACTIVATED; the flip lands in the persisted store.
    const t4 = await cron.tickOnce();
    expect(t4.activated).toBe(1);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('live');
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '2' }]);

    // Tick 5 — converged: newest === active, nothing left to drive.
    const t5 = await cron.tickOnce();
    expect(t5.candidates).toBe(0);
    expect(t5.regressionsRun).toBe(0);
  });

  it('drives a brand-new AOP (no active version yet) through the same gate', async () => {
    const store = createInMemoryAOPRegistryStore();
    await store.putRegressionSet(REGRESSION_SET as never);
    await store.putSpec(specOf('1') as never);
    const cron = createAopMetaLoopCron({
      store,
      executor: switchableExecutor(),
      logger: fakeLogger(),
      enabled: false,
    });
    const first = await cron.tickOnce();
    expect(first.candidates).toBe(1);
    expect(first.enrolled).toBe(1);
    expect(first.promoted).toBe(1);
    // Activation still requires the FULL ladder — never instant.
    expect(await activeVersionsOf(store)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The propose-only rail
// ---------------------------------------------------------------------------

describe('aop meta-loop — propose-only rail', () => {
  it('a failing regression NEVER promotes and NEVER flips the active version', async () => {
    const store = await seededStore();
    const adapter = createInProcessCanaryAdapter();
    const executor = switchableExecutor();
    executor.setMode('fail');
    const cron = createAopMetaLoopCron({
      store,
      executor,
      adapter,
      logger: fakeLogger(),
      enabled: false,
    });

    const t1 = await cron.tickOnce();
    expect(t1.gateFailed).toBe(1);
    expect(t1.promoted).toBe(0);
    expect(t1.activated).toBe(0);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('shadow');
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '1' }]);

    // Next tick: held at shadow, no re-enrol churn, still no promotion.
    const t2 = await cron.tickOnce();
    expect(t2.enrolled).toBe(0);
    expect(t2.gateFailed).toBe(1);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('shadow');
  });

  it('holds the candidate fail-closed when no executor is wired (no fake pass)', async () => {
    const store = await seededStore();
    const adapter = createInProcessCanaryAdapter();
    const logger = fakeLogger();
    const cron = createAopMetaLoopCron({
      store,
      executor: null,
      adapter,
      logger,
      enabled: false,
    });
    const t1 = await cron.tickOnce();
    expect(t1.enrolled).toBe(1); // PROPOSE still happens (zero traffic)
    expect(t1.skipped).toBe(1);
    expect(t1.regressionsRun).toBe(0);
    expect(t1.promoted).toBe(0);
    expect(t1.activated).toBe(0);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('shadow');
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '1' }]);
    expect(
      logger.records.some((r) => r.level === 'warn' && r.msg.includes('executor unavailable')),
    ).toBe(true);
  });

  it('holds fail-closed when the regression set is missing', async () => {
    const store = createInMemoryAOPRegistryStore();
    // Spec references a set that is never registered (hydration trusts rows).
    await store.putSpec(specOf('1') as never);
    const cron = createAopMetaLoopCron({
      store,
      executor: switchableExecutor(),
      logger: fakeLogger(),
      enabled: false,
    });
    const t1 = await cron.tickOnce();
    expect(t1.skipped).toBe(1);
    expect(t1.promoted).toBe(0);
    expect(await activeVersionsOf(store)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Quality drift — demotion
// ---------------------------------------------------------------------------

describe('aop meta-loop — drift rollback', () => {
  it('demotes a climbing candidate one rung when its regression starts failing', async () => {
    const store = await seededStore();
    const adapter = createInProcessCanaryAdapter();
    const executor = switchableExecutor();
    const cron = createAopMetaLoopCron({
      store,
      executor,
      adapter,
      logger: fakeLogger(),
      enabled: false,
    });

    await cron.tickOnce(); // shadow → 1pct
    await cron.tickOnce(); // 1pct → 5pct
    expect(await adapter.getStage(AOP_ID, '2')).toBe('canary-5pct');

    executor.setMode('fail');
    const drift = await cron.tickOnce();
    expect(drift.gateFailed).toBe(1);
    expect(drift.demoted).toBe(1);
    expect(await adapter.getStage(AOP_ID, '2')).toBe('canary-1pct');
    // The active version never moved off the proven v1.
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '1' }]);
  });
});

// ---------------------------------------------------------------------------
// Fail-safe rails
// ---------------------------------------------------------------------------

describe('aop meta-loop — fail-safe', () => {
  it('a store fault resolves the tick (errored counted, never thrown)', async () => {
    const broken: AOPRegistryStore = {
      async putSpec() {},
      async listSpecs() {
        throw new Error('db down');
      },
      async putRegressionSet() {},
      async listRegressionSets() {
        return [];
      },
      async putActiveVersion() {},
      async listActiveVersions() {
        return [];
      },
    };
    const cron = createAopMetaLoopCron({
      store: broken,
      executor: switchableExecutor(),
      logger: fakeLogger(),
      enabled: false,
    });
    const result = await cron.tickOnce();
    expect(result.errored).toBeGreaterThanOrEqual(1);
    expect(result.promoted).toBe(0);
  });

  it('an executor fault becomes an honest failed trace — gate fails, no throw', async () => {
    const store = await seededStore();
    const throwing: AOPExecutor = {
      async execute() {
        throw new Error('anthropic 500');
      },
    };
    const cron = createAopMetaLoopCron({
      store,
      executor: throwing,
      logger: fakeLogger(),
      enabled: false,
    });
    const result = await cron.tickOnce();
    // The runner converts the throw into a failed trace; the regression
    // report fails the gate — counted as gateFailed, not a crash.
    expect(result.gateFailed).toBe(1);
    expect(result.activated).toBe(0);
    expect(await activeVersionsOf(store)).toEqual([{ id: AOP_ID, version: '1' }]);
  });
});

// ---------------------------------------------------------------------------
// Kill-switch / test-env gate
// ---------------------------------------------------------------------------

describe('aop meta-loop — start gating', () => {
  it('does not arm the timer under NODE_ENV=test (default)', async () => {
    const logger = fakeLogger();
    const cron = createAopMetaLoopCron({
      store: await seededStore(),
      executor: null,
      logger,
      env: { NODE_ENV: 'test' },
    });
    cron.start();
    expect(logger.records.some((r) => r.msg.includes('disabled (no start)'))).toBe(true);
    expect(logger.records.some((r) => r.msg === 'aop-meta-loop: started')).toBe(false);
    cron.stop();
  });

  it('does not arm the timer when the kill-switch is off', async () => {
    const logger = fakeLogger();
    const cron = createAopMetaLoopCron({
      store: await seededStore(),
      executor: null,
      logger,
      env: { NODE_ENV: 'production', [AOP_META_LOOP_KILL_SWITCH_ENV]: 'off' },
    });
    cron.start();
    expect(logger.records.some((r) => r.msg.includes('disabled (no start)'))).toBe(true);
    cron.stop();
  });

  it('arms (and disarms) the unref-ed timer when enabled', async () => {
    const logger = fakeLogger();
    const cron = createAopMetaLoopCron({
      store: await seededStore(),
      executor: null,
      logger,
      enabled: true,
    });
    cron.start();
    expect(logger.records.some((r) => r.msg === 'aop-meta-loop: started')).toBe(true);
    cron.start(); // duplicate start is a warn, not a second timer
    expect(
      logger.records.some((r) => r.level === 'warn' && r.msg.includes('duplicate start')),
    ).toBe(true);
    cron.stop();
  });
});

// ---------------------------------------------------------------------------
// In-process canary adapter — governance stage math
// ---------------------------------------------------------------------------

describe('createInProcessCanaryAdapter', () => {
  it('mirrors the governance ladder: enrol→shadow, promote throws at live, demote floors at shadow', async () => {
    const adapter = createInProcessCanaryAdapter();
    expect(await adapter.getStage('a', '1')).toBeNull();
    await expect(adapter.promoteStage('a', '1')).rejects.toThrow(/not enrolled/);

    await adapter.enrol('a', '1');
    expect(await adapter.getStage('a', '1')).toBe('shadow');
    expect(await adapter.demoteStage('a', '1')).toBeNull(); // floor

    expect(await adapter.promoteStage('a', '1')).toBe('canary-1pct');
    expect(await adapter.promoteStage('a', '1')).toBe('canary-5pct');
    expect(await adapter.promoteStage('a', '1')).toBe('canary-25pct');
    expect(await adapter.promoteStage('a', '1')).toBe('live');
    await expect(adapter.promoteStage('a', '1')).rejects.toThrow(/already at live/);

    await adapter.retire('a', '1');
    expect(await adapter.getStage('a', '1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Anthropic executor
// ---------------------------------------------------------------------------

describe('createAnthropicAopExecutor', () => {
  function fakeClient(text: string): AopAnthropicClientLike & {
    readonly calls: Array<Record<string, unknown>>;
  } {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      defaultModel: 'claude-haiku-4-5',
      sdk: {
        messages: {
          async create(request) {
            calls.push(request as unknown as Record<string, unknown>);
            return { content: [{ type: 'text', text }] };
          },
        },
      },
    };
  }

  const spec = specOf('1') as never;

  it('returns null when no budget-guarded factory is configured (honest degrade)', () => {
    expect(
      createAnthropicAopExecutor({ buildBudgetGuardedAnthropicClient: null }),
    ).toBeNull();
  });

  it('drives the AOP system prompt through the budget-guarded client, text-only', async () => {
    const client = fakeClient('Buyers in arrears: B-7.');
    const tenants: string[] = [];
    const executor = createAnthropicAopExecutor({
      buildBudgetGuardedAnthropicClient: (tenantId) => {
        tenants.push(tenantId);
        return client;
      },
    });
    const result = await executor!.execute(spec, {
      userMessage: 'Which buyers are in arrears?',
    });
    expect(result.finalOutput).toBe('Buyers in arrears: B-7.');
    expect(result.toolCalls).toEqual([]); // text-only replay rail
    expect(tenants).toEqual(['_platform']); // platform budget scope
    expect(client.calls[0]?.system).toBe(
      'You are the royalty triage operating procedure.',
    );
    expect(client.calls[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('rejects a non-anthropic model descriptor at wire time', async () => {
    const executor = createAnthropicAopExecutor({
      buildBudgetGuardedAnthropicClient: () => fakeClient('x'),
    });
    const foreign = {
      ...(specOf('1') as Record<string, unknown>),
      model: { provider: 'openai', name: 'gpt-x' },
    } as never;
    await expect(
      executor!.execute(foreign, { userMessage: 'hi' }),
    ).rejects.toThrow(/unsupported provider 'openai'/);
  });
});

// ---------------------------------------------------------------------------
// Candidate derivation (pure)
// ---------------------------------------------------------------------------

describe('deriveCandidates', () => {
  it('picks the newest version per id and skips converged AOPs', async () => {
    const store = await seededStore();
    const registry = await createAOPRegistry({ store });
    const before = deriveCandidates(registry);
    expect(before.aopsSeen).toBe(1);
    expect(before.candidates.map((c) => c.version)).toEqual(['2']);

    await registry.setActiveVersion(AOP_ID, '2');
    const after = deriveCandidates(registry);
    expect(after.candidates).toEqual([]);
  });
});
