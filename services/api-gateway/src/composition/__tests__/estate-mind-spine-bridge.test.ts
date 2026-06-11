/**
 * OK-4 (Wave 1 conductor) — EstateMind → arbiter-fronted spine bridge.
 *
 * Proves the dual sink emits an `OrchestratorRequest` proposal IN ADDITION
 * to the existing proactive_nudge, WITHOUT actuating:
 *
 *   - `composeDualSink` keeps the base proactive_nudge write (rails intact)
 *     AND emits a mapped OrchestratorRequest into the spine sink;
 *   - the mapped request carries the evidence ids (Auditor evidence rail)
 *     and is PROPOSAL-only — no think()/execute call exists on the sink;
 *   - a spine fault is swallowed so the proactive_nudge still succeeds
 *     (never break the tick).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  composeDualSink,
  estateProposalToOrchestratorRequest,
  createAuditOrchestratorProposalSink,
  type OrchestratorProposalSink,
} from '../estate-mind-wiring.js';
import type { estateMind as estateMindKernel } from '@borjie/central-intelligence';
import type { orchestrator } from '@borjie/central-intelligence';

type EstateProposal = estateMindKernel.EstateProposal;
type ProposalSink = estateMindKernel.ProposalSink;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function proposal(over: Partial<EstateProposal> = {}): EstateProposal {
  return {
    tenantId: 'tenant-A',
    id: 'drive:cash-runway',
    driveId: 'cash-runway',
    title: 'Cash runway needs attention',
    rationale: 'cash runway below the 30-day floor',
    urgency: 'high',
    breachSeverity: 0.6,
    evidenceEntityIds: ['cash-1', 'cash-2'],
    proposedAtMs: 1000,
    ...over,
  };
}

describe('estateProposalToOrchestratorRequest — OK-4 mapping', () => {
  it('maps title+rationale → userMessage and evidence ids → citations', () => {
    const req = estateProposalToOrchestratorRequest(proposal());
    expect(req.userMessage).toContain('Cash runway needs attention');
    expect(req.userMessage).toContain('30-day floor');
    expect(req.groundingCitationIds).toEqual(['cash-1', 'cash-2']);
    // Tenant-scoped, evidence-required (Auditor rail), persona set.
    expect(req.scope.kind).toBe('tenant');
    expect(req.evidenceRequired).toBe(true);
    expect(req.persona).toBe('mr-mwikila-head');
  });
});

describe('composeDualSink — OK-4 dual emission (proposal-not-actuation)', () => {
  it('keeps the base nudge AND emits an OrchestratorRequest to the spine', async () => {
    const baseCalls: Array<EstateProposal> = [];
    const base: ProposalSink = {
      async propose(p) {
        baseCalls.push(p);
        return true; // surfaced
      },
    };
    const spineCalls: Array<orchestrator.OrchestratorRequest> = [];
    const spine: OrchestratorProposalSink = {
      async proposeRequest(r) {
        spineCalls.push(r);
        return true;
      },
    };

    const dual = composeDualSink(base, spine, silentLogger);
    const surfaced = await dual.propose(proposal());

    // (1) base nudge preserved + authoritative return.
    expect(surfaced).toBe(true);
    expect(baseCalls).toHaveLength(1);
    // (2) spine proposal emitted with the mapped request.
    expect(spineCalls).toHaveLength(1);
    expect(spineCalls[0]?.threadId).toContain('estate-mind:tenant-A');
    expect(spineCalls[0]?.groundingCitationIds).toEqual(['cash-1', 'cash-2']);
  });

  it('the spine sink is PROPOSAL-only — exposes no think()/execute surface', () => {
    const sink = createAuditOrchestratorProposalSink(silentLogger);
    // The port surface is exactly { proposeRequest } — no actuation method.
    expect(Object.keys(sink)).toEqual(['proposeRequest']);
    expect((sink as Record<string, unknown>).think).toBeUndefined();
    expect((sink as Record<string, unknown>).execute).toBeUndefined();
  });

  it('FAIL-SAFE: a spine fault still lets the proactive_nudge succeed', async () => {
    const base: ProposalSink = {
      async propose() {
        return true;
      },
    };
    const warn = vi.fn();
    const spine: OrchestratorProposalSink = {
      async proposeRequest() {
        throw new Error('spine offline');
      },
    };
    const dual = composeDualSink(base, spine, {
      ...silentLogger,
      warn,
    });
    // The tick is NOT broken — the base nudge result is still returned.
    await expect(dual.propose(proposal())).resolves.toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('the default audit spine sink records without actuating', async () => {
    const sink = createAuditOrchestratorProposalSink(silentLogger);
    const ok = await sink.proposeRequest(
      estateProposalToOrchestratorRequest(proposal()),
    );
    expect(ok).toBe(true);
  });
});
