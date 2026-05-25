import { beforeEach, describe, expect, it } from 'vitest';
import {
  createVulnerablePopulationsService,
  getVulnerabilitySafeguards,
} from '../vulnerable-populations/index.js';
import { createInMemoryStore } from '../in-memory-store.js';
import type { VulnerablePopulationsService } from '../vulnerable-populations/index.js';
import type { VulnerabilityFactor } from '../types.js';

describe('getVulnerabilitySafeguards — pure helper', () => {
  it('minor (GLOBAL) yields guardian-required + no-marketing + no-automated-decision + simplified-language', () => {
    const sgs = getVulnerabilitySafeguards({
      factors: ['minor'],
      jurisdiction: 'GLOBAL',
    });
    const kinds = sgs.map((s) => s.kind).sort();
    expect(kinds).toEqual(
      ['guardian-required', 'no-automated-decision', 'no-marketing', 'simplified-language'].sort(),
    );
  });

  it('elderly + TZ — global plus TZ-specific advocacy-contact + in-person-only', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['elderly'], jurisdiction: 'TZ' });
    const kinds = sgs.map((s) => s.kind);
    expect(kinds).toContain('advocacy-contact');
    expect(kinds).toContain('in-person-only');
    expect(kinds).toContain('larger-text');
  });

  it('elderly + KE — global only (no KE-specific elderly rule)', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['elderly'], jurisdiction: 'KE' });
    const kinds = sgs.map((s) => s.kind);
    expect(kinds).toContain('larger-text');
    expect(kinds).toContain('cooling-off-extension');
    expect(kinds).not.toContain('in-person-only');
  });

  it('disabled + TZ — global + TZ PWDA advocacy-contact', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['disabled'], jurisdiction: 'TZ' });
    const sources = sgs.map((s) => s.source);
    expect(sources.some((s) => s.includes('TZ Persons with Disabilities Act'))).toBe(true);
  });

  it('disabled + US — adds ADA + FHA advocacy and no-automated-decision', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['disabled'], jurisdiction: 'US' });
    const kinds = sgs.map((s) => s.kind);
    expect(kinds).toContain('no-automated-decision');
    expect(kinds).toContain('advocacy-contact');
  });

  it('displaced — translator + simplified-language + advocacy-contact', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['displaced'], jurisdiction: 'GLOBAL' });
    const kinds = sgs.map((s) => s.kind).sort();
    expect(kinds).toEqual(['advocacy-contact', 'simplified-language', 'translator']);
  });

  it('victim-of-violence + US — yields VAWA-cited advocacy + manual review', () => {
    const sgs = getVulnerabilitySafeguards({ factors: ['victim-of-violence'], jurisdiction: 'US' });
    const sources = sgs.map((s) => s.source).join(' ');
    expect(sources).toContain('VAWA');
    expect(sgs.map((s) => s.kind)).toContain('no-automated-decision');
  });

  it('language-barrier yields translator + simplified-language + audio-summary', () => {
    const kinds = getVulnerabilitySafeguards({
      factors: ['language-barrier'],
      jurisdiction: 'GLOBAL',
    }).map((s) => s.kind);
    expect(kinds).toContain('translator');
    expect(kinds).toContain('simplified-language');
    expect(kinds).toContain('audio-summary');
  });

  it('multiple factors deduplicate by kind (jurisdiction-specific wins)', () => {
    const sgs = getVulnerabilitySafeguards({
      factors: ['elderly', 'disabled'],
      jurisdiction: 'TZ',
    });
    // advocacy-contact appears in TZ-specific elderly + TZ-specific disabled.
    const advocacies = sgs.filter((s) => s.kind === 'advocacy-contact');
    expect(advocacies.length).toBe(1);
    expect(advocacies[0]?.jurisdiction).toBe('TZ');
  });

  it('survivor-of-eviction yields mandatory-explanation + advocacy', () => {
    const kinds = getVulnerabilitySafeguards({
      factors: ['survivor-of-eviction'],
      jurisdiction: 'GLOBAL',
    }).map((s) => s.kind);
    expect(kinds).toContain('mandatory-explanation');
    expect(kinds).toContain('advocacy-contact');
  });

  it('refugee yields in-person-only + translator + advocacy', () => {
    const kinds = getVulnerabilitySafeguards({
      factors: ['refugee'],
      jurisdiction: 'GLOBAL',
    }).map((s) => s.kind);
    expect(kinds).toContain('in-person-only');
    expect(kinds).toContain('translator');
  });
});

describe('VulnerablePopulationsService — store-backed flow', () => {
  let svc: VulnerablePopulationsService;

  beforeEach(() => {
    svc = createVulnerablePopulationsService({ store: createInMemoryStore() });
  });

  it('flagVulnerable + flagsFor round-trip', async () => {
    const flag = await svc.flagVulnerable({
      subjectId: 'sub-1',
      factors: ['elderly', 'language-barrier'] as ReadonlyArray<VulnerabilityFactor>,
      jurisdiction: 'TZ',
      evidenceSummary: 'tenant told us at intake',
    });
    expect(flag.factors).toContain('elderly');
    const all = await svc.flagsFor('sub-1');
    expect(all.length).toBe(1);
    expect(all[0]?.evidenceSummary).toBe('tenant told us at intake');
  });

  it('safeguardsFor union across all flags', async () => {
    await svc.flagVulnerable({
      subjectId: 'sub-2',
      factors: ['elderly'],
      jurisdiction: 'TZ',
    });
    await svc.flagVulnerable({
      subjectId: 'sub-2',
      factors: ['disabled'],
      jurisdiction: 'TZ',
    });
    const sgs = await svc.safeguardsFor({ subjectId: 'sub-2', jurisdiction: 'TZ' });
    const kinds = sgs.map((s) => s.kind);
    expect(kinds).toContain('larger-text'); // disabled (GLOBAL)
    expect(kinds).toContain('in-person-only'); // elderly (TZ)
    expect(kinds).toContain('advocacy-contact'); // both
  });

  it('rejects flagging with zero factors', async () => {
    await expect(
      svc.flagVulnerable({
        subjectId: 'x',
        factors: [],
        jurisdiction: 'TZ',
      }),
    ).rejects.toThrow('zero factors');
  });
});
