/**
 * Unified admission control tests.
 *
 * Proves the ONE-chokepoint law:
 *   - a clean tab admits ok with zero violations
 *   - each rule (url-egress, evidence-presence, locale-purity,
 *     action-label-binding) catches its own violation, reported under the right
 *     `rule` id and `path`
 *   - rules compose: a tab failing two rules reports both, in one pass (no
 *     short-circuit) and never throws
 *   - the returned `sealedTab` ALWAYS carries audit chain hashes, even on failure
 *   - admission never mutates the input tab
 *   - the registry is closed-under-extension (every id present, stable order)
 */

import { describe, it, expect } from 'vitest';

import {
  admitTab,
  isMutatingVerb,
  ADMISSION_RULES,
  ADMISSION_RULE_IDS,
  type AdmissionPolicy,
} from '../admit.js';
import { buildFallbackTab } from '../../generator/fallbacks.js';
import { verifyAuditChain } from '../../audit/audit-chain.js';
import { GENESIS_HASH, hashAuditEntry } from '../../audit/audit-chain.js';
import type { PortalTab, PortalTabSection, PortalTabWidget } from '../../types.js';

const NOW = '2026-06-13T10:00:00.000Z';

function cleanTab(): PortalTab {
  return buildFallbackTab({
    intent: {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: [],
      sourceMessage: 'track staff payroll',
      usedLlm: false,
    },
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
    nowIso: NOW,
    id: 'tab_a',
    sourceConversationId: undefined,
  });
}

/** A widget that binds a mutating tool — used by the action-label rule tests. */
function toolWidget(
  overrides: Partial<PortalTabWidget> & { title: string },
): PortalTabWidget {
  return {
    key: 'w_action',
    kind: 'kpi_card',
    config: null,
    binding: { kind: 'tool', toolId: 'export_records' },
    ...overrides,
  } as PortalTabWidget;
}

/** Replace the first section of a tab with a hand-built one. */
function withFirstSection(tab: PortalTab, section: PortalTabSection): PortalTab {
  return { ...tab, sections: [section, ...tab.sections.slice(1)] };
}

describe('admitTab — clean path', () => {
  it('admits a clean tab with zero violations', () => {
    const result = admitTab(cleanTab());
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('always returns a sealedTab whose audit chain verifies', () => {
    const result = admitTab(cleanTab());
    expect(verifyAuditChain(result.sealedTab.audit).ok).toBe(true);
    const h0 = (result.sealedTab.audit.history[0] as { hash?: string }).hash;
    expect(h0).toBe(hashAuditEntry(GENESIS_HASH, cleanTab().audit.history[0]!));
  });

  it('never mutates the input tab (no hash leaks back onto the source)', () => {
    const tab = cleanTab();
    admitTab(tab);
    expect((tab.audit.history[0] as { hash?: string }).hash).toBeUndefined();
  });
});

describe('admitTab — url-egress rule', () => {
  const policy: AdmissionPolicy = {
    urlEgress: { allowedHosts: ['borjie.app'] },
  };

  it('catches a disallowed URL anywhere in the spec', () => {
    const tab = cleanTab();
    const section = withFirstSection(tab, {
      ...tab.sections[0]!,
      description: 'https://evil.example/exfil?d=secret',
    });
    const result = admitTab(section, policy);
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.rule === 'url-egress');
    expect(v).toBeDefined();
    expect(v!.detail).toContain('evil.example');
  });

  it('passes an allowlisted URL', () => {
    const tab = cleanTab();
    const section = withFirstSection(tab, {
      ...tab.sections[0]!,
      description: 'https://cdn.borjie.app/logo.png',
    });
    expect(admitTab(section, policy).ok).toBe(true);
  });

  it('is a no-op when no egress policy is supplied', () => {
    const tab = cleanTab();
    const section = withFirstSection(tab, {
      ...tab.sections[0]!,
      description: 'https://evil.example/x',
    });
    expect(admitTab(section).ok).toBe(true);
  });
});

describe('admitTab — evidence-presence rule', () => {
  it('flags a section with no evidence when evidence is required', () => {
    const result = admitTab(cleanTab(), { requireEvidence: true });
    expect(result.ok).toBe(false);
    expect(result.violations.every((v) => v.rule === 'evidence-presence')).toBe(
      true,
    );
    expect(result.violations[0]!.path).toBe('sections[0]');
  });

  it('passes when every section carries an evidence ref', () => {
    const tab = cleanTab();
    const withEvidence: PortalTab = {
      ...tab,
      sections: tab.sections.map(
        (s) => ({ ...s, evidenceIds: ['lmbm:abc'] }) as PortalTabSection,
      ),
    };
    expect(admitTab(withEvidence, { requireEvidence: true }).ok).toBe(true);
  });

  it('is off by default (back-compat)', () => {
    expect(admitTab(cleanTab()).ok).toBe(true);
  });
});

describe('admitTab — locale-purity rule (zero-mixing)', () => {
  // detector(text,'en') flags a Swahili intrusion; detector(text,'sw') flags
  // an English intrusion — exactly how the mixing rule probes each string.
  const policy: AdmissionPolicy = {
    localeDetector: (text, locale) => {
      if (locale === 'en') return /\bmshahara\b/i.test(text);
      if (locale === 'sw') return /\bpayroll\b/i.test(text);
      return false;
    },
  };

  it('flags a tab that MIXES en + sw', () => {
    const tab = cleanTab();
    const mixed: PortalTab = {
      ...tab,
      title: 'Payroll overview',
      sections: tab.sections.map((s, i) =>
        i === 0
          ? ({ ...s, title: 'Mshahara wa wafanyakazi' } as PortalTabSection)
          : s,
      ),
    };
    const result = admitTab(mixed, policy);
    expect(result.ok).toBe(false);
    expect(result.violations.some((x) => x.rule === 'locale-purity')).toBe(true);
  });

  it('passes a single-language tab (no mixing)', () => {
    // cleanTab() is single-language — no Swahili intrusion is added, so the
    // mixing rule sees at most one language and does not flag.
    expect(admitTab(cleanTab(), policy).ok).toBe(true);
  });

  it('is a no-op when no detector is supplied', () => {
    expect(admitTab(cleanTab(), {}).ok).toBe(true);
  });
});

describe('admitTab — action-label-binding rule', () => {
  it('flags a read-implying label over a mutating tool binding', () => {
    const tab = cleanTab();
    const section: PortalTabSection = {
      ...tab.sections[0]!,
      widgets: [
        ...tab.sections[0]!.widgets,
        toolWidget({ title: 'Payroll', subtitle: 'View report' }),
      ],
    };
    const result = admitTab(withFirstSection(tab, section));
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.rule === 'action-label-binding');
    expect(v).toBeDefined();
    expect(v!.detail).toContain('export_records');
  });

  it('passes when the label is honestly active', () => {
    const tab = cleanTab();
    const section: PortalTabSection = {
      ...tab.sections[0]!,
      widgets: [
        ...tab.sections[0]!.widgets,
        toolWidget({ title: 'Export records', subtitle: 'Download CSV' }),
      ],
    };
    expect(admitTab(withFirstSection(tab, section)).ok).toBe(true);
  });

  it('ignores a read-implying label over a query binding (no mutation)', () => {
    const tab = cleanTab();
    const section: PortalTabSection = {
      ...tab.sections[0]!,
      widgets: [
        ...tab.sections[0]!.widgets,
        {
          key: 'w_q',
          kind: 'table',
          title: 'View licences',
          config: null,
          binding: { kind: 'query', resource: 'licences' },
        } as PortalTabWidget,
      ],
    };
    expect(admitTab(withFirstSection(tab, section)).ok).toBe(true);
  });
});

describe('admitTab — composition + invariants', () => {
  it('reports violations from multiple rules in one pass (no short-circuit)', () => {
    const tab = cleanTab();
    const section: PortalTabSection = {
      ...tab.sections[0]!,
      description: 'https://evil.example/x',
      widgets: [
        ...tab.sections[0]!.widgets,
        toolWidget({ title: 'Payroll', subtitle: 'View report' }),
      ],
    };
    const result = admitTab(withFirstSection(tab, section), {
      urlEgress: { allowedHosts: ['borjie.app'] },
      requireEvidence: true,
    });
    expect(result.ok).toBe(false);
    const rules = new Set(result.violations.map((v) => v.rule));
    expect(rules.has('url-egress')).toBe(true);
    expect(rules.has('evidence-presence')).toBe(true);
    expect(rules.has('action-label-binding')).toBe(true);
  });

  it('still seals the audit chain even when admission fails', () => {
    const tab = cleanTab();
    const section = withFirstSection(tab, {
      ...tab.sections[0]!,
      description: 'https://evil.example/x',
    });
    const result = admitTab(section, {
      urlEgress: { allowedHosts: ['borjie.app'] },
    });
    expect(result.ok).toBe(false);
    expect(verifyAuditChain(result.sealedTab.audit).ok).toBe(true);
    expect(
      (result.sealedTab.audit.history[0] as { hash?: string }).hash,
    ).toBeTruthy();
  });

  it('never throws on a structurally odd tab', () => {
    const odd = { ...cleanTab(), sections: [] } as unknown as PortalTab;
    expect(() => admitTab(odd, { requireEvidence: true })).not.toThrow();
  });
});

describe('admission registry — closed under extension', () => {
  it('exposes every rule id exactly once, in stable order', () => {
    expect(ADMISSION_RULES.map((r) => r.id)).toEqual([...ADMISSION_RULE_IDS]);
  });

  it('isMutatingVerb classifies mutating vs read tools', () => {
    expect(isMutatingVerb('export_records')).toBe(true);
    expect(isMutatingVerb('create_reminder')).toBe(true);
    expect(isMutatingVerb('recompute_royalty_estimate')).toBe(true);
    expect(isMutatingVerb('licences')).toBe(false);
  });
});
