/**
 * loop-economy-wiring.test.ts — locks the loop-economy un-darking contract:
 *
 *   1. composition emits the boot-proof signal with loopsRegistered (the
 *      organ going dark again is detectable);
 *   2. registry composition: the builtin forecast-surprise loop registers;
 *      formed-loop hydration parses untrusted specs (malformed dropped
 *      with an honest log, never a crash);
 *   3. a full FOLD → SCHEDULE → MEMBRANE → LEARN tick runs against
 *      in-memory fakes: a surprising snapshot fires the loop and routes a
 *      drive-keyed EstateProposal through the gated sink; a calm snapshot
 *      does not fire; a re-fire coalesces (idempotent sink contract);
 *   4. error ticks never throw: a throwing sink / snapshot reader / tenant
 *      source resolve with errored counted (fail-safe rails);
 *   5. the kill-switch / test-env gate keeps start() inert;
 *   6. honest degrade: a loop whose organ port has no reader registers
 *      DORMANT with the missing dep NAMED; an actPort with no governed
 *      resolver HOLDS the action (propose-only membrane, fail-closed).
 */

import { describe, expect, it } from 'vitest';

import {
  LOOP_ECONOMY_KILL_SWITCH_ENV,
  actionToEstateProposal,
  createLoopEconomyCron,
  createProposeConcernResolver,
  type ActPortResolver,
  type OrganPortReader,
  type ProposalSinkLike,
} from '../loop-economy-wiring';
import {
  loopEconomy,
  type estateMind as estateMindNs,
  type situationalModel as situationalModelNs,
} from '@borjie/central-intelligence';
import type { PinoLikeLogger } from '../../utils/pino-shim';

type SituationalSnapshot = situationalModelNs.SituationalSnapshot;
type ActivatedEntity = situationalModelNs.ActivatedEntity;
type EstateProposal = estateMindNs.EstateProposal;

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

function entity(entityId: string, attributes: Record<string, unknown>): ActivatedEntity {
  return {
    entity: {
      tenantId: 't1',
      entityId,
      kind: 'cash',
      label: entityId,
      attributes,
      referenceCount: 1,
      firstReferencedAtMs: 0,
      lastReferencedAtMs: 0,
      associations: {},
      updatedAtMs: 0,
    },
    activation: 1,
    baseLevel: 1,
    spreading: 0,
  };
}

function snapshotOf(entities: ActivatedEntity[]): SituationalSnapshot {
  return {
    tenantId: 't1',
    entities,
    broadcast: entities[0] ?? null,
    computedAtMs: 0,
  };
}

// surpriseDrift > 0.4 band → FORECAST_SURPRISE_DRIVE unsatisfied → loop fires.
const SURPRISING = snapshotOf([entity('cash-1', { surpriseDrift: 0.8 })]);
const CALM = snapshotOf([entity('cash-1', { surpriseDrift: 0.1 })]);

function fakeSink(
  surfaced = true,
): ProposalSinkLike & { readonly proposals: EstateProposal[] } {
  const proposals: EstateProposal[] = [];
  return {
    proposals,
    async propose(p) {
      proposals.push(p);
      return surfaced;
    },
  };
}

interface CronOverrides {
  readonly snapshot?: SituationalSnapshot | null;
  readonly snapshotReader?: OrganPortReader;
  readonly sink?: ProposalSinkLike;
  readonly actPortResolvers?: Readonly<Record<string, ActPortResolver>> | null;
  readonly tenants?: ReadonlyArray<string>;
  readonly listActiveTenantIds?: () => Promise<ReadonlyArray<string>>;
  readonly hydrateFormedLoops?: () => Promise<ReadonlyArray<loopEconomy.DefineLoopSpecInput>>;
  readonly logger?: PinoLikeLogger;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly enabled?: boolean;
  readonly clock?: () => number;
}

function cronWith(over: CronOverrides = {}) {
  const sink = over.sink ?? fakeSink();
  const reader: OrganPortReader =
    over.snapshotReader ??
    (async () => (over.snapshot === undefined ? SURPRISING : over.snapshot));
  return createLoopEconomyCron({
    organPortReaders: { [loopEconomy.SITUATIONAL_SNAPSHOT_PORT]: reader },
    actPortResolvers:
      over.actPortResolvers === null
        ? {}
        : (over.actPortResolvers ?? {
            [loopEconomy.FORECAST_SURPRISE_ACT_PORT]:
              createProposeConcernResolver(sink),
          }),
    listActiveTenantIds:
      over.listActiveTenantIds ?? (async () => over.tenants ?? ['t1']),
    ...(over.hydrateFormedLoops ? { hydrateFormedLoops: over.hydrateFormedLoops } : {}),
    logger: over.logger ?? fakeLogger(),
    ...(over.env ? { env: over.env } : {}),
    // Omit `enabled` unless a test sets it, so the env/kill-switch path is
    // genuinely exercised (vitest runs under NODE_ENV=test → inert default).
    ...(over.enabled !== undefined ? { enabled: over.enabled } : {}),
    clock: over.clock ?? (() => 10_000_000),
  });
}

/** A minimal valid FORMED-loop input (always fires, observe-only). */
function formedInput(id: string): loopEconomy.DefineLoopSpecInput {
  return {
    id,
    title: `formed ${id}`,
    trigger: { kind: 'tick', everyMs: 1 },
    actPort: 'proactive.proposeConcern',
    learnPort: 'reflexion.scoreLoopEfficacy',
    createdAtMs: 0,
    evaluate: () => true,
    decide: () => null,
  };
}

// ---------------------------------------------------------------------------
// Boot-proof signal + registry composition
// ---------------------------------------------------------------------------

describe('createLoopEconomyCron — composition signal', () => {
  it('emits the structured boot-proof log line at composition time', () => {
    const logger = fakeLogger();
    cronWith({ logger });
    const boot = logger.records.find(
      (r) => r.level === 'info' && r.msg.includes('cognitive-loop substrate composed'),
    );
    expect(boot).toBeDefined();
    expect(boot?.meta.wiring).toBe('loop-economy');
    expect(boot?.meta.loopsRegistered).toBe(1); // the forecast-surprise builtin
    expect(boot?.meta.builtinLoops).toBe(1);
    expect(boot?.meta.formedLoopStoreWired).toBe(false); // honest: no store exists
    expect(boot?.meta.killSwitchEnvFlag).toBe(LOOP_ECONOMY_KILL_SWITCH_ENV);
  });

  it('registers the builtin forecast-surprise loop on the live registry', () => {
    const cron = cronWith();
    const spec = cron.registry.get(loopEconomy.FORECAST_SURPRISE_LOOP_ID);
    expect(spec).toBeDefined();
    expect(spec?.origin).toBe('builtin');
    expect(spec?.actPort).toBe(loopEconomy.FORECAST_SURPRISE_ACT_PORT);
  });

  it('hydrates FORMED loops on the first tick, dropping malformed specs honestly', async () => {
    const logger = fakeLogger();
    const cron = cronWith({
      logger,
      snapshot: CALM,
      hydrateFormedLoops: async () => [
        formedInput('formed:ok'),
        // Malformed: empty id fails the substrate's own zod rail.
        { ...formedInput(''), id: '' },
      ],
    });
    await cron.tickOnce();
    expect(cron.registry.get('formed:ok')?.origin).toBe('formed');
    expect(cron.registry.size()).toBe(2); // builtin + the one valid formed loop
    expect(
      logger.records.some(
        (r) => r.level === 'warn' && r.msg.includes('malformed FORMED loop dropped'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FOLD → SCHEDULE → MEMBRANE → LEARN
// ---------------------------------------------------------------------------

describe('loop-economy — a tick against in-memory fakes', () => {
  it('a surprising snapshot fires the loop and surfaces a drive-keyed governed proposal', async () => {
    const sink = fakeSink(true);
    const cron = cronWith({ sink, snapshot: SURPRISING });
    const result = await cron.tickOnce();
    expect(result.tenantsScanned).toBe(1);
    expect(result.firings).toBe(1);
    expect(result.proposed).toBe(1);
    expect(result.held).toBe(0);
    expect(result.errored).toBe(0);

    const proposal = sink.proposals[0];
    expect(proposal).toBeDefined();
    // The kernel's drive-keyed id — coalesces with EstateMind's own nudge.
    expect(proposal?.id).toBe('drive:forecast-surprise');
    expect(proposal?.driveId).toBe('forecast-surprise');
    expect(proposal?.tenantId).toBe('t1');
    expect(proposal?.rationale.length).toBeGreaterThan(0);
    // Evidence chain is REAL: the snapshot entities the loop read.
    expect(proposal?.evidenceEntityIds).toContain('cash-1');
    expect(proposal?.breachSeverity).toBeGreaterThan(0);
  });

  it('a calm snapshot does not fire (the loop evaluate gates)', async () => {
    const sink = fakeSink(true);
    const cron = cronWith({ sink, snapshot: CALM });
    const result = await cron.tickOnce();
    expect(result.firings).toBe(0);
    expect(result.proposed).toBe(0);
    expect(sink.proposals).toEqual([]);
  });

  it('a re-fire coalesces when the idempotent sink reports already-pending', async () => {
    const sink = fakeSink(false); // sink: undelivered row already exists
    const cron = cronWith({ sink, snapshot: SURPRISING });
    const result = await cron.tickOnce();
    expect(result.coalesced).toBe(1);
    expect(result.proposed).toBe(0);
  });

  it('LEARN: efficacy is scored onto the registry via the reflexion EMA', async () => {
    const sink = fakeSink(true);
    const cron = cronWith({ sink, snapshot: SURPRISING });
    const t1 = await cron.tickOnce();
    expect(t1.scored).toBe(1);
    // First score: surfaced → 1.
    expect(cron.registry.get(loopEconomy.FORECAST_SURPRISE_LOOP_ID)?.efficacy).toBe(1);
  });

  it('a null snapshot leaves the loop dormant for that tenant (no firing, no crash)', async () => {
    const cron = cronWith({ snapshot: null });
    const result = await cron.tickOnce();
    expect(result.firings).toBe(0);
    expect(result.errored).toBe(0);
  });

  it('a FORMED loop whose retireCondition fires is pruned by the sweep', async () => {
    const cron = cronWith({
      snapshot: CALM,
      hydrateFormedLoops: async () => [
        { ...formedInput('formed:stale'), retireCondition: () => true },
      ],
    });
    const result = await cron.tickOnce();
    expect(result.retired).toBe(1);
    expect(cron.registry.get('formed:stale')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fail-safe rails — an error tick never throws
// ---------------------------------------------------------------------------

describe('loop-economy — fail-safe', () => {
  it('a throwing sink holds the action and counts errored (never thrown)', async () => {
    const sink: ProposalSinkLike = {
      async propose() {
        throw new Error('db down');
      },
    };
    const cron = cronWith({ sink, snapshot: SURPRISING });
    const result = await cron.tickOnce();
    expect(result.held).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.proposed).toBe(0);
  });

  it('a throwing snapshot reader degrades to a declined pass (portFaults counted)', async () => {
    const cron = cronWith({
      snapshotReader: async () => {
        throw new Error('store fault');
      },
    });
    const result = await cron.tickOnce();
    expect(result.portFaults).toBe(1);
    expect(result.firings).toBe(0);
    expect(result.errored).toBe(0);
  });

  it('a throwing tenant source resolves the tick with errored counted', async () => {
    const cron = cronWith({
      listActiveTenantIds: async () => {
        throw new Error('tenants table gone');
      },
    });
    const result = await cron.tickOnce();
    expect(result.errored).toBe(1);
    expect(result.tenantsScanned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Honest degrade — dormant loops + the propose-only membrane
// ---------------------------------------------------------------------------

describe('loop-economy — honest degrade', () => {
  it('registers the builtin DORMANT with the missing organ dep NAMED when no reader is bound', () => {
    const logger = fakeLogger();
    createLoopEconomyCron({
      organPortReaders: {}, // no production source for situationalSnapshot
      actPortResolvers: {},
      listActiveTenantIds: null,
      logger,
      enabled: false,
    });
    const dormant = logger.records.find(
      (r) => r.level === 'warn' && r.msg.includes('registered DORMANT'),
    );
    expect(dormant).toBeDefined();
    expect(dormant?.meta.loopId).toBe(loopEconomy.FORECAST_SURPRISE_LOOP_ID);
    expect(dormant?.meta.missingOrganPorts).toEqual([
      loopEconomy.SITUATIONAL_SNAPSHOT_PORT,
    ]);
  });

  it('HOLDS a decided action whose actPort has no governed resolver (never executed)', async () => {
    const logger = fakeLogger();
    const cron = cronWith({
      logger,
      snapshot: SURPRISING,
      actPortResolvers: null, // empty membrane table
    });
    const result = await cron.tickOnce();
    expect(result.firings).toBe(1);
    expect(result.held).toBe(1);
    expect(result.proposed).toBe(0);
    expect(
      logger.records.some(
        (r) => r.level === 'warn' && r.msg.includes('no governed resolver'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kill-switch / test-env gate
// ---------------------------------------------------------------------------

describe('loop-economy — start gating', () => {
  it('does not arm the timer under NODE_ENV=test (default)', () => {
    const logger = fakeLogger();
    const cron = cronWith({ logger, env: { NODE_ENV: 'test' } });
    cron.start();
    expect(logger.records.some((r) => r.msg.includes('disabled (no start)'))).toBe(true);
    expect(logger.records.some((r) => r.msg === 'loop-economy: started')).toBe(false);
    cron.stop();
  });

  it('does not arm the timer when the kill-switch is off', () => {
    const logger = fakeLogger();
    const cron = cronWith({
      logger,
      env: { NODE_ENV: 'production', [LOOP_ECONOMY_KILL_SWITCH_ENV]: 'off' },
    });
    cron.start();
    expect(logger.records.some((r) => r.msg.includes('disabled (no start)'))).toBe(true);
    cron.stop();
  });

  it('arms (and disarms) the unref-ed timer when enabled', () => {
    const logger = fakeLogger();
    const cron = cronWith({ logger, enabled: true });
    cron.start();
    expect(logger.records.some((r) => r.msg === 'loop-economy: started')).toBe(true);
    cron.start(); // duplicate start is a warn, not a second timer
    expect(
      logger.records.some((r) => r.level === 'warn' && r.msg.includes('duplicate start')),
    ).toBe(true);
    cron.stop();
  });
});

// ---------------------------------------------------------------------------
// actionToEstateProposal (pure mapper)
// ---------------------------------------------------------------------------

describe('actionToEstateProposal', () => {
  const firingOf = (over: Partial<loopEconomy.DefineLoopSpecInput> = {}) => {
    const loop = loopEconomy.defineLoopSpec({
      id: 'formed:x',
      title: 'Formed concern',
      trigger: { kind: 'tick', everyMs: 1000 },
      actPort: 'proactive.proposeConcern',
      learnPort: 'reflexion.scoreLoopEfficacy',
      createdAtMs: 0,
      ...over,
    });
    return { loop, action: null } as const;
  };

  it('holds (null) when the descriptor lacks a tenantId', () => {
    const out = actionToEstateProposal({
      firing: firingOf(),
      action: {
        actPort: 'proactive.proposeConcern',
        autonomyTier: 'T1',
        summary: 'concern',
        args: {},
      },
      ports: {},
      nowMs: 5,
    });
    expect(out).toBeNull();
  });

  it('prefers explicit evidenceEntityIds and falls back to loop-keyed ids without a drive', () => {
    const out = actionToEstateProposal({
      firing: firingOf(),
      action: {
        actPort: 'proactive.proposeConcern',
        autonomyTier: 'T1',
        summary: 'concern',
        args: {
          tenantId: 't9',
          evidenceEntityIds: ['licence-7'],
          urgency: 'critical',
          breachSeverity: 2, // clamped to 1
        },
      },
      ports: {},
      nowMs: 5,
    });
    expect(out?.id).toBe('loop:formed:x'); // no driveId → loop-keyed dedupe id
    expect(out?.tenantId).toBe('t9');
    expect(out?.urgency).toBe('critical');
    expect(out?.breachSeverity).toBe(1);
    expect(out?.evidenceEntityIds).toEqual(['licence-7']);
    expect(out?.proposedAtMs).toBe(5);
  });
});
