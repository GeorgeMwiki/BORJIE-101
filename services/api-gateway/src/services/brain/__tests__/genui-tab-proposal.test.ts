/**
 * Brain → portal-genui bridge tests (seam #3).
 *
 * Drives `buildGenuiTabProposal` with a real in-memory portal-genui engine
 * (heuristic intent + deterministic generator — no LLM, no DB) and asserts:
 *
 *   - a high-confidence tab-authoring message yields a `tab_proposal` payload
 *     that PREVIEWS the real fields (title + per-section field/widget summary
 *     + the full validated tab) — before any persist.
 *   - generation is preview-only: NOTHING is persisted (the registry stays
 *     empty), so the owner confirms first.
 *   - a non-authoring message yields null (no chip).
 *   - the bilingual reason honours the active locale (absolute toggle).
 *   - a thrown engine failure is swallowed → null (fail-soft, never breaks
 *     the teaching reply).
 */

import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { createGenUIEngine, type GenUIEngine } from '@borjie/portal-genui';

import { buildGenuiTabProposal } from '../genui-tab-proposal.js';

const logger = pino({ level: 'silent' });

describe('buildGenuiTabProposal', () => {
  it('emits a field-previewing proposal for a high-confidence authoring intent', async () => {
    const engine = createGenUIEngine();
    const proposal = await buildGenuiTabProposal({
      engine,
      message: 'we need to track our staff payroll',
      tenantId: 'tenant_A',
      userId: 'user_1',
      language: 'en',
      logger,
    });

    expect(proposal).not.toBeNull();
    expect(proposal!.tagKind).toBe('tab_proposal');
    expect(proposal!.source).toBe('portal-genui');
    expect(proposal!.domain).toBe('hr');
    expect(proposal!.title.length).toBeGreaterThan(0);
    // The preview carries the REAL fields (summary + full tab).
    expect(proposal!.summary.sectionCount).toBeGreaterThan(0);
    expect(proposal!.summary.fieldCount).toBeGreaterThan(0);
    expect(proposal!.summary.sections[0]?.fieldLabels.length ?? 0).toBeGreaterThan(0);
    expect(proposal!.tab.tabKey).toBe(proposal!.tabKey);
    // English reason, absolute locale.
    expect(proposal!.reason).toContain('tab');
  });

  it('does NOT persist — generation is preview-only', async () => {
    const engine = createGenUIEngine();
    const proposal = await buildGenuiTabProposal({
      engine,
      message: 'please add a supplier onboarding tab',
      tenantId: 'tenant_A',
      userId: 'user_1',
      language: 'en',
      logger,
    });
    expect(proposal).not.toBeNull();
    // Nothing was written to the registry — the chip previews only.
    const size = await engine.persistence.size();
    expect(size).toBe(0);
  });

  it('returns null for a non-authoring message (no chip)', async () => {
    const engine = createGenUIEngine();
    const proposal = await buildGenuiTabProposal({
      engine,
      message: "what's the rent due this month?",
      tenantId: 'tenant_A',
      userId: 'user_1',
      language: 'en',
      logger,
    });
    expect(proposal).toBeNull();
  });

  it('renders the reason in Swahili when locale is sw', async () => {
    const engine = createGenUIEngine();
    const proposal = await buildGenuiTabProposal({
      engine,
      message: 'we need to track our staff payroll',
      tenantId: 'tenant_A',
      userId: 'user_1',
      language: 'sw',
      logger,
    });
    expect(proposal).not.toBeNull();
    // Swahili reason — absolute toggle, no English mixing.
    expect(proposal!.reason).toContain('kichupo');
    expect(proposal!.reason).not.toContain(' tab ');
  });

  it('fails soft to null when the engine throws', async () => {
    const broken: GenUIEngine = {
      ...createGenUIEngine(),
      detectIntent: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const proposal = await buildGenuiTabProposal({
      engine: broken,
      message: 'we need to track our staff payroll',
      tenantId: 'tenant_A',
      userId: 'user_1',
      language: 'en',
      logger,
    });
    expect(proposal).toBeNull();
  });
});
