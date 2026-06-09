/**
 * md-gap-detector tests — W2e: the Capability Gap Register goes LIVE.
 *
 * `createMdGapDetector(repo)` is the PRODUCTION `GapDetectorPort` adapter that
 * the kernel tool-dispatcher's detection seam calls when a tool-resolution miss
 * happens (a NOT_YET_WIRED organ → `unwired_organ`; an absent tool →
 * `missing_tool`). It derives a durable gap row GENERATIVELY from the miss — no
 * per-case hardcode — and writes it best-effort via `repo.createGap`.
 *
 * Proven here:
 *   - a simulated tool-miss records EXACTLY ONE durable gap row (the spec);
 *   - the row is keyed on the missing tool, born `blocked`, with the
 *     `tool_registered:<toolName>` unblock trigger + a competence coordinate
 *     derived from the tool namespace;
 *   - the same miss every tick stays idempotent (still exactly one row);
 *   - a platform-scope miss writes NOTHING (no tenant to key on) — honest no-op;
 *   - a sovereign-classified miss is born sovereign (parks HITL);
 *   - a repo fault is swallowed (best-effort; never throws back into dispatch).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  type MdCommitmentRepository,
} from '@borjie/database/repositories';
import { orchestrator } from '@borjie/central-intelligence';

import {
  createMdGapDetector,
  buildConfiguredMdGapDetector,
  configureMdDeferTools,
  competenceDomainFromTool,
} from '../md-defer-tools';

type GapDetectorPort = orchestrator.GapDetectorPort;
type HookContext = Parameters<
  GapDetectorPort['recordUnwiredOrganGap']
>[0]['ctx'];

const TENANT = 'tenant-gap-live';
const MISSING_TOOL = 'platform.suspend_licence';

/** A tenant-scoped HookContext — the gap row's tenant comes from here. */
function tenantCtx(tenantId: string): HookContext {
  return {
    threadId: 'thr-live-1',
    scope: {
      kind: 'tenant',
      tenantId,
      actorUserId: 'user-mwikila',
      roles: ['owner'],
      personaId: 'mr-mwikila-head',
    } as HookContext['scope'],
    tier: 'tenant',
    userMessage: 'suspend the Geita licence',
    tickStartedAt: 0,
  };
}

/** A platform-scope HookContext — no tenant to key a durable gap on. */
function platformCtx(): HookContext {
  return {
    threadId: 'thr-live-2',
    scope: {
      kind: 'platform',
      actorUserId: 'industry-observer',
      roles: ['platform'],
      personaId: 'industry-observer',
    } as HookContext['scope'],
    tier: 'industry',
    userMessage: 'register the new operator class',
    tickStartedAt: 0,
  };
}

function missInput(
  over: Partial<
    Parameters<GapDetectorPort['recordUnwiredOrganGap']>[0]
  > = {},
): Parameters<GapDetectorPort['recordUnwiredOrganGap']>[0] {
  return {
    toolName: MISSING_TOOL,
    gapKind: 'unwired_organ',
    intent: `executor-failed: ${MISSING_TOOL} adapter not yet wired`,
    sovereign: false,
    ctx: tenantCtx(TENANT),
    ...over,
  };
}

describe('createMdGapDetector — the live capability-gap seam', () => {
  it('records EXACTLY ONE durable gap row from a simulated tool-miss', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const detector = createMdGapDetector(repo);

    await detector.recordUnwiredOrganGap(missInput());

    const gaps = await repo.listOpenGaps(TENANT);
    expect(gaps).toHaveLength(1);
    const gap = gaps[0];
    expect(gap?.gapKind).toBe('unwired_organ');
    expect(gap?.status).toBe('blocked');
    expect(gap?.kind).toBe(MISSING_TOOL);
    expect(gap?.unblockTrigger).toEqual({
      kind: 'tool_registered',
      target: MISSING_TOOL,
    });
    // competence domain derived from the tool namespace (generative, no list).
    expect(gap?.competenceDomain).toBe('platform');
    expect(gap?.evidenceIds).toEqual([`gap:${MISSING_TOOL}`]);
    expect(gap?.confirmedAtMs).toBeNull();
    expect(gap?.sovereign).toBe(false);
  });

  it('is idempotent — the same miss every tick stays exactly one row', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const detector = createMdGapDetector(repo);

    await detector.recordUnwiredOrganGap(missInput());
    await detector.recordUnwiredOrganGap(missInput());
    await detector.recordUnwiredOrganGap(missInput());

    expect(await repo.listOpenGaps(TENANT)).toHaveLength(1);
  });

  it('keys a missing-tool (not-found) miss as a missing_tool gap', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const detector = createMdGapDetector(repo);

    await detector.recordUnwiredOrganGap(
      missInput({
        toolName: 'royalty.file_return',
        gapKind: 'missing_tool',
        intent: 'tool not found: royalty.file_return',
      }),
    );

    const gaps = await repo.listOpenGaps(TENANT);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.gapKind).toBe('missing_tool');
    expect(gaps[0]?.competenceDomain).toBe('royalty');
    expect(gaps[0]?.unblockTrigger).toEqual({
      kind: 'tool_registered',
      target: 'royalty.file_return',
    });
  });

  it('writes NOTHING for a platform-scope miss (no tenant to key on)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const detector = createMdGapDetector(repo);

    await detector.recordUnwiredOrganGap(missInput({ ctx: platformCtx() }));

    // No tenant → no durable gap row anywhere (honest no-op, never invented).
    expect(await repo.listOpenGaps(TENANT)).toHaveLength(0);
    expect(await repo.listOpenGaps('platform')).toHaveLength(0);
  });

  it('a sovereign-classified miss is born sovereign (parks HITL)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    const detector = createMdGapDetector(repo);

    await detector.recordUnwiredOrganGap(missInput({ sovereign: true }));

    const gap = (await repo.listOpenGaps(TENANT))[0];
    expect(gap?.sovereign).toBe(true);
  });

  it('swallows a repo fault — best-effort, never throws back into dispatch', async () => {
    const throwingRepo = {
      async createGap(): Promise<never> {
        throw new Error('db down');
      },
    } as unknown as MdCommitmentRepository;
    const warnings: Array<Record<string, unknown>> = [];
    const detector = createMdGapDetector(throwingRepo, {
      warn: (meta) => warnings.push(meta),
    });

    // MUST resolve (not reject) — the dispatcher swallows but we never throw.
    await expect(
      detector.recordUnwiredOrganGap(missInput()),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.wiring).toBe('md-gap-detector');
  });
});

describe('buildConfiguredMdGapDetector — lazy repo resolution', () => {
  it('records a gap via the SINGLETON repo configured at composition time', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    configureMdDeferTools({ repo });
    const detector = buildConfiguredMdGapDetector();

    await detector.recordUnwiredOrganGap(missInput());

    // The gap landed in the repo wired via configureMdDeferTools (no re-thread).
    const gaps = await repo.listOpenGaps(TENANT);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.kind).toBe(MISSING_TOOL);
  });
});

describe('competenceDomainFromTool — generative namespace derivation', () => {
  it('takes the leading namespace segment', () => {
    expect(competenceDomainFromTool('platform.suspend_licence')).toBe('platform');
    expect(competenceDomainFromTool('royalty:file-return')).toBe('royalty');
    expect(competenceDomainFromTool('treasury_release_funds')).toBe('treasury');
    expect(competenceDomainFromTool('md/transfer')).toBe('md');
  });

  it('returns null for an unnamespaced bareword', () => {
    expect(competenceDomainFromTool('')).toBeNull();
    expect(competenceDomainFromTool('.leading')).toBeNull();
  });
});
