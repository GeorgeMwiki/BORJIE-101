/**
 * Tests for the self-healing MAPE-K kernel. They lock the HONEST contract:
 *   - the loop NEVER throws and ALWAYS returns proceed:true (the user is served);
 *   - the bounded SAFE declarative class is auto-repaired (and crystallized);
 *   - the CODE class is ESCALATED as a human-gated proposal (never auto-applied);
 *   - an UNRECOGNISED blocker is made-known as 'novel' and escalated, not swallowed.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  attemptHeal,
  classifyBlocker,
  type BlockerSignal,
  type RepairProposal,
} from '../self-heal.js';

const sig = (over: Partial<BlockerSignal>): BlockerSignal => ({
  kind: 'unknown-render-kind',
  locus: 'sections[0].widgets[1]',
  detail: 'no renderer for kind x',
  ...over,
});

describe('classifyBlocker', () => {
  it('maps safe declarative blockers to auto-repair classes', () => {
    expect(classifyBlocker(sig({ kind: 'unknown-render-kind' }))).toBe('reroute-degrade');
    expect(classifyBlocker(sig({ kind: 'unmapped-binding' }))).toBe('rebind-generic');
    expect(classifyBlocker(sig({ kind: 'admission-violation' }))).toBe('reroute-degrade');
  });

  it('maps code/wiring blockers to escalate-code (never auto)', () => {
    expect(classifyBlocker(sig({ kind: 'render-error' }))).toBe('escalate-code');
    expect(classifyBlocker(sig({ kind: 'unwired-rule' }))).toBe('escalate-code');
    expect(classifyBlocker(sig({ kind: 'dead-export' }))).toBe('escalate-code');
  });

  it('maps an unrecognised kind to escalate-novel', () => {
    expect(classifyBlocker(sig({ kind: 'something-we-never-saw' as never }))).toBe('escalate-novel');
  });
});

describe('attemptHeal — the bounded safe class auto-repairs', () => {
  it('auto-repairs an unknown render kind by serving the honest fallback', () => {
    const remember = vi.fn();
    const out = attemptHeal(sig({ kind: 'unknown-render-kind' }), { remember });
    expect(out.status).toBe('auto-repaired');
    expect(out.proceed).toBe(true);
    expect(out.class).toBe('reroute-degrade');
    expect(remember).toHaveBeenCalledTimes(1); // crystallized
    // Always carries the observation record (admin visibility), never auto-applied.
    expect(out.proposal).toBeDefined();
    expect(out.proposal.autoApplicable).toBe(false);
    expect(out.proposal.insight.length).toBeGreaterThan(0);
    expect(out.proposal.actionPlan.length).toBeGreaterThan(0);
  });

  it('auto-repairs an unmapped binding by re-binding to the generic resolver', () => {
    const out = attemptHeal(sig({ kind: 'unmapped-binding' }));
    expect(out.status).toBe('auto-repaired');
    expect(out.class).toBe('rebind-generic');
    expect(out.proceed).toBe(true);
  });
});

describe('attemptHeal — the report sink gives the admin FULL visibility', () => {
  it('reports the auto-healed OBSERVATION (not just escalations)', () => {
    const report = vi.fn();
    const escalate = vi.fn();
    const out = attemptHeal(sig({ kind: 'unknown-render-kind' }), { report, escalate });
    expect(report).toHaveBeenCalledTimes(1);
    expect(escalate).not.toHaveBeenCalled(); // auto-repair is NOT human-gated
    const [outcome, signal] = report.mock.calls[0];
    expect(outcome.status).toBe('auto-repaired');
    expect(outcome.proposal.insight.length).toBeGreaterThan(0);
    expect(signal.kind).toBe('unknown-render-kind');
    expect(out.proposal.actionPlan.length).toBeGreaterThan(0);
  });

  it('reports AND escalates a code-gated blocker (both fire)', () => {
    const report = vi.fn();
    const escalate = vi.fn();
    attemptHeal(sig({ kind: 'corrupt-spec', locus: 'portal_tabs/abc' }), { report, escalate });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].status).toBe('escalated');
  });

  it('a failing report sink never breaks the loop', () => {
    const boom = () => {
      throw new Error('report sink down');
    };
    const out = attemptHeal(sig({ kind: 'unknown-render-kind' }), { report: boom });
    expect(out.proceed).toBe(true);
  });
});

describe('attemptHeal — the code class escalates (human-gated), still proceeds', () => {
  it('escalates a code/wiring blocker as a NON-auto-applicable proposal and still serves', () => {
    const escalate = vi.fn();
    const out = attemptHeal(sig({ kind: 'unwired-rule', locus: 'admit.ts:registry' }), { escalate });
    expect(out.status).toBe('escalated');
    expect(out.class).toBe('escalate-code');
    expect(out.proceed).toBe(true); // user STILL served (degraded)
    expect(out.proposal).toBeDefined();
    expect((out.proposal as RepairProposal).autoApplicable).toBe(false);
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it('flags an unrecognised blocker as novel + escalates (never silent)', () => {
    const escalate = vi.fn();
    const out = attemptHeal(sig({ kind: 'mystery' as never }), { escalate });
    expect(out.status).toBe('escalated');
    expect(out.class).toBe('escalate-novel');
    expect(out.proceed).toBe(true);
    expect(out.proposal?.title).toMatch(/novel/i);
    expect(escalate).toHaveBeenCalledTimes(1);
  });
});

describe('attemptHeal — robustness (the healer is itself total)', () => {
  it('never throws even on a malformed signal, and still proceeds', () => {
    const out = attemptHeal({} as BlockerSignal);
    expect(out.proceed).toBe(true);
    expect(['auto-repaired', 'escalated']).toContain(out.status);
  });

  it('a failing crystallize/escalate sink never breaks the loop', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    const a = attemptHeal(sig({ kind: 'unknown-render-kind' }), { remember: boom });
    const b = attemptHeal(sig({ kind: 'unwired-rule' }), { escalate: boom });
    expect(a.proceed).toBe(true);
    expect(b.proceed).toBe(true);
  });
});
