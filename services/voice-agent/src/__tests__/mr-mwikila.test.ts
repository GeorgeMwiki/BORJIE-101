import { describe, expect, it } from 'vitest';

import {
  buildMrMwikilaSystemPrompt,
  MR_MWIKILA_TOOLS,
} from '../personas/mr-mwikila.js';

describe('MR_MWIKILA_TOOLS', () => {
  it('declares the four canonical tools', () => {
    const names = MR_MWIKILA_TOOLS.map((tool) => tool.name).sort();
    expect(names).toEqual(['book_viewing', 'log_payment', 'lookup_lease', 'raise_ticket']);
  });

  it('flags state-changing tools as requiring human confirmation', () => {
    const byName = Object.fromEntries(MR_MWIKILA_TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.lookup_lease?.requiresHumanConfirmation).toBe(false);
    expect(byName.log_payment?.requiresHumanConfirmation).toBe(true);
    expect(byName.book_viewing?.requiresHumanConfirmation).toBe(true);
    expect(byName.raise_ticket?.requiresHumanConfirmation).toBe(false);
  });
});

describe('buildMrMwikilaSystemPrompt', () => {
  const baseOptions = { tenantId: 'tenant_abc', language: 'sw' as const };

  it('introduces the persona by name', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    expect(prompt).toContain('Mr. Mwikila');
    expect(prompt).toContain('BORJIE');
  });

  it('interpolates tenant id and language', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    expect(prompt).toContain('tenant_abc');
    expect(prompt).toContain('Caller language: sw');
  });

  it('defaults jurisdiction to TZ when not provided', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    expect(prompt).toContain('Jurisdiction: TZ');
  });

  it('uppercases an explicit jurisdiction', () => {
    const prompt = buildMrMwikilaSystemPrompt({
      ...baseOptions,
      jurisdictionCountry: 'ke',
    });
    expect(prompt).toContain('Jurisdiction: KE');
  });

  it('lists all four canonical tools', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    expect(prompt).toContain('lookup_lease');
    expect(prompt).toContain('log_payment');
    expect(prompt).toContain('book_viewing');
    expect(prompt).toContain('raise_ticket');
  });

  it('cites Constitution C09 (NO-AUTONOMOUS-FILING)', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    expect(prompt).toContain('Constitution C09');
    expect(prompt).toContain('NO-AUTONOMOUS-FILING');
  });

  it('builds in the escalation script for state-changing tools', () => {
    const prompt = buildMrMwikilaSystemPrompt(baseOptions);
    // log_payment and book_viewing are flagged — the prompt should narrate
    // the human-confirmation escalation rather than imply finality.
    expect(prompt).toContain('REQUIRES human confirmation');
  });

  it('is deterministic for the same inputs', () => {
    const a = buildMrMwikilaSystemPrompt(baseOptions);
    const b = buildMrMwikilaSystemPrompt(baseOptions);
    expect(a).toBe(b);
  });
});
