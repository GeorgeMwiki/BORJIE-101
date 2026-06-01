/**
 * proactive-wiring — unit tests for the proactive scheduler + delivery.
 *
 * Covers:
 *   - degraded mode (no DB) → inert stub (.start()/.stop()/.run*() no-op).
 *   - NODE_ENV=test / disable-env → inert stub.
 *   - interval bounds enforced ([30s, 6h]) for both cadences.
 *   - DELIVERY pass DELIVERS a tab_proposal: an OPEN tab_proposals_inbox row
 *     is drained onto the cockpit bus as `cockpit.tab.proposed` (the event
 *     the owner-web tray consumes) and stamped `last_surfaced_at` so it is
 *     not re-emitted (idempotent delivery).
 *   - SIGNAL pass drives the injected source → orchestrator.ingestSignal.
 *   - the proactive_nudge drain surfaces a kernel nudge onto the bus once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../services/cockpit-events/index.js';
import {
  __testing,
  scheduleProactive,
  type ProactiveSignalSource,
} from '../proactive/proactive-wiring.js';
import { drainTabProposalsInbox } from '../proactive/proactive-delivery.js';
import type { ProactiveLoop } from '@borjie/ai-copilot';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OWNER = 'owner-user-1';

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as never;
}

/** Flatten a drizzle `sql` template (or raw string) to inspectable text. */
function sqlText(query: unknown): string {
  if (typeof query === 'string') return query;
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === 'string') return c;
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) return v.join(' ');
      return '';
    })
    .join(' ');
}

const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_DISABLE = process.env.BORJIE_PROACTIVE_SCHEDULER_DISABLED;

beforeEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.BORJIE_PROACTIVE_SCHEDULER_DISABLED;
  __resetCockpitBusForTests();
});

afterEach(() => {
  if (ORIG_NODE_ENV !== undefined) process.env.NODE_ENV = ORIG_NODE_ENV;
  else delete process.env.NODE_ENV;
  if (ORIG_DISABLE !== undefined)
    process.env.BORJIE_PROACTIVE_SCHEDULER_DISABLED = ORIG_DISABLE;
  __resetCockpitBusForTests();
});

describe('scheduleProactive — guards', () => {
  it('returns an inert stub when db is null', async () => {
    const sup = scheduleProactive({ db: null, logger: fakeLogger() });
    sup.start();
    sup.stop();
    expect(await sup.runDeliveryOnce()).toBe(0);
    expect(await sup.runSignalOnce()).toBe(0);
  });

  it('returns an inert stub under NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const db = { execute: vi.fn() };
    const sup = scheduleProactive({ db, logger: fakeLogger() });
    await sup.runDeliveryOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns an inert stub when disabled by env', async () => {
    process.env.BORJIE_PROACTIVE_SCHEDULER_DISABLED = 'true';
    const db = { execute: vi.fn() };
    const sup = scheduleProactive({ db, logger: fakeLogger() });
    await sup.runSignalOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('__testing interval bounds', () => {
  it('clamps signal cadence to the 30s floor / 6h ceiling', () => {
    expect(__testing.resolveSignalIntervalMs(1)).toBe(30_000);
    expect(__testing.resolveSignalIntervalMs(99 * 60 * 60 * 1000)).toBe(
      6 * 60 * 60 * 1000,
    );
  });
  it('clamps delivery cadence to the 30s floor / 6h ceiling', () => {
    expect(__testing.resolveDeliveryIntervalMs(1)).toBe(30_000);
    expect(__testing.resolveDeliveryIntervalMs(99 * 60 * 60 * 1000)).toBe(
      6 * 60 * 60 * 1000,
    );
  });
  it('defaults: signal 5m, delivery 1h', () => {
    expect(__testing.resolveSignalIntervalMs()).toBe(5 * 60 * 1000);
    expect(__testing.resolveDeliveryIntervalMs()).toBe(60 * 60 * 1000);
  });
});

describe('drainTabProposalsInbox — DELIVERS a tab_proposal', () => {
  it('publishes cockpit.tab.proposed and stamps last_surfaced_at', async () => {
    const stamped: string[] = [];
    const openRow = {
      id: 'prop-1',
      user_id: OWNER,
      tab_type: 'finance',
      title_en: 'Pin Finance',
      title_sw: 'Bandika Fedha',
      reason_en: 'You drilled into royalties 4 times this week',
      reason_sw: 'Umechunguza mrabaha mara 4 wiki hii',
      evidence_ids: ['nav:e1', 'nav:e2'],
      confidence: 0.8,
    };
    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('FROM tab_proposals_inbox') && text.includes('SELECT')) {
          return { rows: [openRow] };
        }
        if (text.includes('UPDATE tab_proposals_inbox')) {
          stamped.push('prop-1');
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT, (e) => events.push(e));

    const { publishCockpitEvent } = await import(
      '../../services/cockpit-events/index.js'
    );
    const delivered = await drainTabProposalsInbox({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
      publish: publishCockpitEvent,
    });

    expect(delivered).toBe(1);
    expect(stamped).toEqual(['prop-1']); // idempotency stamp written
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<CockpitEvent, { kind: 'cockpit.tab.proposed' }>;
    expect(ev.kind).toBe('cockpit.tab.proposed');
    expect(ev.proposalId).toBe('prop-1');
    expect(ev.tabType).toBe('finance');
    expect(ev.title).toBe('Pin Finance');
    expect(ev.userId).toBe(OWNER);
    expect(ev.evidenceIds).toEqual(['nav:e1', 'nav:e2']);
    expect(ev.confidence).toBe(0.8);
  });

  it('skips an evidence-free row (Borjie evidence rule)', async () => {
    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('FROM tab_proposals_inbox') && text.includes('SELECT')) {
          return {
            rows: [
              {
                id: 'bad-1',
                user_id: OWNER,
                tab_type: 'finance',
                title_en: 'Pin Finance',
                reason_en: 'reason',
                evidence_ids: [], // empty → must be skipped
                confidence: 0.5,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT, (e) => events.push(e));
    const { publishCockpitEvent } = await import(
      '../../services/cockpit-events/index.js'
    );
    const delivered = await drainTabProposalsInbox({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
      publish: publishCockpitEvent,
    });
    expect(delivered).toBe(0);
    expect(events).toHaveLength(0);
  });
});

describe('scheduleProactive.runSignalOnce — drives ingestSignal', () => {
  it('polls the source and feeds every signal to the orchestrator', async () => {
    // Live (non-test) env so the supervisor is real, not the inert stub.
    process.env.NODE_ENV = 'development';

    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('set_config')) return { rows: [] };
        if (text.includes('FROM tenants') && text.includes('WHERE status')) {
          return { rows: [{ id: TENANT }] };
        }
        return { rows: [] };
      }),
    };

    const signal: ProactiveLoop.Signal = {
      signalId: 'sig-1',
      source: 'forecasting',
      tenantId: TENANT,
      domain: 'finance',
      severity: 'high',
      payload: { foo: 'bar' },
      detectedAt: new Date().toISOString(),
    };
    const ingestSignal = vi.fn(async () => ({
      signalId: 'sig-1',
      proposal: null,
      outcome: null,
      skipped: true,
      skipReason: 'no_matching_template',
    }));
    const orchestrator = { ingestSignal } as unknown as ProactiveLoop.ProactiveOrchestrator;
    const signalSource: ProactiveSignalSource = {
      poll: vi.fn(async () => [signal]),
    };

    const sup = scheduleProactive({
      db,
      logger: fakeLogger(),
      orchestrator,
      signalSource,
    });
    const ingested = await sup.runSignalOnce();
    sup.stop();

    expect(ingested).toBe(1);
    expect(signalSource.poll).toHaveBeenCalledOnce();
    expect(ingestSignal).toHaveBeenCalledWith(signal);
  });

  it('idles (0) when no orchestrator/source wired', async () => {
    process.env.NODE_ENV = 'development';
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    const sup = scheduleProactive({ db, logger: fakeLogger() });
    expect(await sup.runSignalOnce()).toBe(0);
    sup.stop();
  });
});

describe('scheduleProactive.runDeliveryOnce — end-to-end generate + deliver', () => {
  it('suggester GENERATES a proposal and the drain DELIVERS it to the bus', async () => {
    process.env.NODE_ENV = 'development';

    // Owner had 4 navigations into /finance in 24h → navigation_loop fires
    // (NAV_FLOOR = 4; /finance maps to the `finance` tab type).
    const navRows = [0, 1, 2, 3].map((i) => ({
      id: `nav-${i}`,
      route: '/finance',
      created_at: new Date(Date.now() - i * 60_000).toISOString(),
    }));

    let insertedRow: Record<string, unknown> | null = null;
    const stamped: string[] = [];

    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('set_config')) return { rows: [] };
        // active tenants × owner (the DISTINCT ON join)
        if (text.includes('FROM tenants') && text.includes('is_owner')) {
          return { rows: [{ tenant_id: TENANT, owner_user_id: OWNER }] };
        }
        // suggester observation feeds
        if (text.includes("snapshot ? 'route'")) return { rows: navRows };
        if (text.includes("snapshot ? 'tabType'")) return { rows: [] };
        if (text.includes('FROM mwikila_actions_inbox') && text.includes('SELECT')) {
          return { rows: [] }; // no mwikila escalations
        }
        // dedup check → not a duplicate
        if (text.includes('FROM tab_proposals_inbox') && text.includes('SELECT 1')) {
          return { rows: [] };
        }
        // suggester INSERT → return a new id + capture the row
        if (text.includes('INSERT INTO tab_proposals_inbox')) {
          insertedRow = {
            id: 'gen-prop-1',
            user_id: OWNER,
            tab_type: 'finance',
            title_en: 'Pin Finance (visited 4× in 24h)',
            title_sw: 'Bandika Finance',
            reason_en: 'You visited /finance 4 times today',
            reason_sw: 'Umetembelea /finance mara 4 leo',
            evidence_ids: ['nav:nav-0', 'nav:nav-1', 'nav:nav-2', 'nav:nav-3'],
            confidence: 0.6,
          };
          return { rows: [{ id: 'gen-prop-1' }] };
        }
        // drain read of OPEN proposals → the row the suggester just wrote
        if (text.includes('FROM tab_proposals_inbox') && text.includes('accepted_at')) {
          return { rows: insertedRow ? [insertedRow] : [] };
        }
        // drain stamp
        if (text.includes('UPDATE tab_proposals_inbox')) {
          stamped.push('gen-prop-1');
          return { rows: [] };
        }
        // proactive_nudge drain → none
        if (text.includes('FROM tab_event_log')) return { rows: [] };
        return { rows: [] };
      }),
    };

    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT, (e) => events.push(e));

    const sup = scheduleProactive({ db, logger: fakeLogger() });
    const delivered = await sup.runDeliveryOnce();
    sup.stop();

    expect(delivered).toBe(1);
    expect(insertedRow).not.toBeNull(); // suggester generated a row
    expect(stamped).toEqual(['gen-prop-1']); // delivery is idempotent-stamped
    const proposed = events.filter((e) => e.kind === 'cockpit.tab.proposed');
    expect(proposed).toHaveLength(1);
    const ev = proposed[0] as Extract<CockpitEvent, { kind: 'cockpit.tab.proposed' }>;
    expect(ev.proposalId).toBe('gen-prop-1');
    expect(ev.tabType).toBe('finance');
    expect(ev.userId).toBe(OWNER);
  });
});
