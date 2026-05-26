/**
 * Repository CRUD tests.
 *
 * Covers:
 *   - `translation_runs` insert + findById + listRecentForTenant +
 *     hash-chain prev_hash continuity.
 *   - `translation_glossary_overrides` upsert respects UNIQUE
 *     (tenant_id, src_term, src_lang, target_lang, register).
 *   - `translation_evals` insert + listForRun returns rows in the
 *     order they were written.
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryGlossaryOverrideRepository } from '../repositories/glossary-overrides.js';
import { createInMemoryTranslationRunRepository } from '../repositories/translation-runs.js';
import { createInMemoryTranslationEvalRepository } from '../repositories/translation-evals.js';
import { GENESIS_HASH } from '../audit/audit-chain-link.js';

describe('repositories', () => {
  it('translation_runs: insert continues the per-tenant hash chain', async () => {
    const repo = createInMemoryTranslationRunRepository();
    const first = await repo.insert({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'parseli',
      targetText: 'parcel',
      provider: 'claude-opus-4-7',
      glossaryTermsUsed: [],
      codeSwitchSegments: [],
      bleu: null,
      chrf: null,
      terminologyAdherence: 1,
      latencyMs: 100,
      costUsdCents: 1,
    });
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(first.auditHash).not.toBe(GENESIS_HASH);

    const second = await repo.insert({
      tenantId: 'tenant-1',
      sourceLang: 'en',
      targetLang: 'sw',
      sourceText: 'parcel',
      targetText: 'parseli',
      provider: 'claude-opus-4-7',
      glossaryTermsUsed: [],
      codeSwitchSegments: [],
      bleu: null,
      chrf: null,
      terminologyAdherence: 1,
      latencyMs: 100,
      costUsdCents: 1,
    });
    // Second insert's prev_hash equals first insert's audit_hash.
    expect(second.prevHash).toBe(first.auditHash);
  });

  it('translation_runs: findById returns null for the wrong tenant', async () => {
    const repo = createInMemoryTranslationRunRepository();
    const persisted = await repo.insert({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'x',
      targetText: 'y',
      provider: 'nllb-200',
      glossaryTermsUsed: [],
      codeSwitchSegments: [],
      bleu: null,
      chrf: null,
      terminologyAdherence: 1,
      latencyMs: 0,
      costUsdCents: 0,
    });
    const wrong = await repo.findById('tenant-2', persisted.id);
    expect(wrong).toBeNull();
    const right = await repo.findById('tenant-1', persisted.id);
    expect(right).not.toBeNull();
    expect(right?.targetText).toBe('y');
  });

  it('translation_glossary_overrides: upsert overwrites on the unique key', async () => {
    const repo = createInMemoryGlossaryOverrideRepository();
    await repo.upsert({
      tenantId: 'tenant-1',
      srcTerm: 'royalty',
      srcLang: 'en',
      targetTerm: 'mrabaha',
      targetLang: 'sw',
      domain: 'financial',
      register: 'formal',
    });
    await repo.upsert({
      tenantId: 'tenant-1',
      srcTerm: 'royalty',
      srcLang: 'en',
      targetTerm: 'mrabaha-mpya', // overwrite
      targetLang: 'sw',
      domain: 'financial',
      register: 'formal',
    });
    const entries = await repo.listForTenant('tenant-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetTerm).toBe('mrabaha-mpya');
  });

  it('translation_evals: listForRun returns rows ordered by judgedAt', async () => {
    let tick = 1000;
    const repo = createInMemoryTranslationEvalRepository({
      now: () => new Date(tick++),
    });
    await repo.insert({
      tenantId: 'tenant-1',
      runId: 'run-1',
      judge: 'bleu',
      score: 35,
      rubric: {},
    });
    await repo.insert({
      tenantId: 'tenant-1',
      runId: 'run-1',
      judge: 'chrf',
      score: 56,
      rubric: {},
    });
    const rows = await repo.listForRun('tenant-1', 'run-1');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.judge).toBe('bleu');
    expect(rows[1]?.judge).toBe('chrf');
  });
});
