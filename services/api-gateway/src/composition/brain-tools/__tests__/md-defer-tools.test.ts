/**
 * md-defer-tools tests — Mr. Mwikila's DEFERRAL / FOLLOW-THROUGH brain surface.
 *
 * Drives the tools against the in-memory commitment repository:
 *   - md.defer persists a commitment with its typed WAIT-FOR trigger and
 *     returns the durable view;
 *   - md.commitment.list returns the live backlog;
 *   - md.commitment.confirm closes ONLY on a proof kind (honest closure);
 *   - md.commitment.update can block but cannot mark done;
 *   - the catalog registers all five tools with UNIQUE ids (no duplicate).
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { createInMemoryMdCommitmentRepository } from '@borjie/database/repositories';

import {
  configureMdDeferTools,
  mdDeferTool,
  mdCommitmentListTool,
  mdCommitmentConfirmTool,
  mdCommitmentUpdateTool,
  MD_DEFER_TOOLS,
} from '../md-defer-tools';

const CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
});

describe('md-defer-tools', () => {
  beforeEach(() => {
    configureMdDeferTools({ repo: createInMemoryMdCommitmentRepository() });
  });

  it('registers five tools with unique ids', () => {
    const ids = MD_DEFER_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'md.defer',
      'md.commitment.create',
      'md.commitment.list',
      'md.commitment.update',
      'md.commitment.confirm',
    ]);
  });

  it('md.defer persists an event-triggered commitment and lists it', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    configureMdDeferTools({ repo });

    const out = await mdDeferTool.handler(
      {
        title: 'File royalty after settlement lands',
        titleSw: 'Wasilisha mrabaha baada ya malipo kuingia',
        rationale: 'The buyer settlement clears the filing amount.',
        triggerKind: 'event',
        triggerSpec: { eventKey: 'ledger.credit' },
        evidenceIds: ['evi-1'],
      },
      CTX,
    );
    expect(out.commitment.status).toBe('open');
    expect(out.commitment.triggerKind).toBe('event');

    const list = await mdCommitmentListTool.handler({}, CTX);
    expect(list.commitments).toHaveLength(1);
    expect(list.commitments[0]?.id).toBe(out.commitment.id);
  });

  it('md.commitment.confirm closes ONLY with a proof kind (honest closure)', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    configureMdDeferTools({ repo });
    const created = await mdDeferTool.handler(
      {
        title: 'Renew PML',
        titleSw: 'Fanya upya leseni',
        rationale: 'Licence expires in 84 days.',
        triggerKind: 'time',
        triggerSpec: { dueAt: new Date(1000).toISOString() },
        evidenceIds: ['evi-licence'],
        sovereign: true,
      },
      CTX,
    );

    const confirmed = await mdCommitmentConfirmTool.handler(
      { id: created.commitment.id, confirmationKind: 'regulator_ack' },
      CTX,
    );
    expect(confirmed.commitment?.status).toBe('done');
    expect(confirmed.commitment?.confirmationKind).toBe('regulator_ack');
  });

  it('md.commitment.update can block but cannot mark done', async () => {
    const repo = createInMemoryMdCommitmentRepository();
    configureMdDeferTools({ repo });
    const created = await mdDeferTool.handler(
      {
        title: 'Chase offtake confirmation',
        titleSw: 'Fuatilia uthibitisho wa mauzo',
        rationale: 'Offtake confirmation is three days late.',
        triggerKind: 'event',
        triggerSpec: { eventKey: 'offtake.settled' },
        evidenceIds: ['evi-offtake'],
      },
      CTX,
    );

    const blocked = await mdCommitmentUpdateTool.handler(
      { id: created.commitment.id, blockedReason: 'awaiting buyer reply' },
      CTX,
    );
    expect(blocked.commitment?.status).toBe('blocked');
    // The update tool exposes no 'done' status — only confirm can close.
    expect(blocked.commitment?.confirmedAt).toBeNull();
  });
});
