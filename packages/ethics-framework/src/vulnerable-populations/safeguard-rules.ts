/**
 * Vulnerable-population safeguard rules.
 *
 * Each rule maps a (factor, jurisdiction) pair to one or more
 * safeguards. The lookup function `safeguardsFor()` returns the union
 * of safeguards across all factor matches plus all GLOBAL rules.
 *
 * Citations:
 *  - TZ Land Act 1999 § 30 (special protection — widows, elderly)
 *  - TZ Persons with Disabilities Act 2010 §§ 30–35 (accessibility)
 *  - KE Rental Housing Act 2017 (proposed; cabinet draft)
 *    + KE Persons with Disabilities Act 2003
 *  - ZA Rental Housing Act 50 of 1999 § 4 (no unfair discrimination)
 *  - UG Persons with Disabilities Act 2020
 *  - RW Law N°01/2007 (Rights of Persons with Disabilities)
 *  - NG Discrimination Against Persons with Disabilities Act 2018
 *  - US FHA Title VIII §§ 804, 805 (1968 + 1988 amendments)
 *  - EU Council Directive 2000/78/EC (equal treatment in employment)
 *  - ABA Tenant Vulnerability handbook (2021)
 *  - Council of Europe Convention on preventing violence against women
 *    (Istanbul Convention, 2011) — Art. 18 protection orders
 */

import type {
  Jurisdiction,
  Safeguard,
  SafeguardKind,
  VulnerabilityFactor,
} from '../types.js';

interface SafeguardRule {
  readonly factor: VulnerabilityFactor;
  readonly jurisdiction: Jurisdiction;
  readonly safeguards: ReadonlyArray<SafeguardKind>;
  readonly source: string;
  readonly reason: string;
}

const RULES: ReadonlyArray<SafeguardRule> = Object.freeze([
  // ── Minors (GLOBAL — children's rights are universal) ───────────────
  {
    factor: 'minor',
    jurisdiction: 'GLOBAL',
    safeguards: [
      'guardian-required',
      'no-marketing',
      'no-automated-decision',
      'simplified-language',
    ],
    source: 'UN Convention on the Rights of the Child (1989), Art. 3 + 16',
    reason: 'Minor — best interests of the child + privacy protection.',
  },
  // ── Elderly (TZ Land Act 1999 §30; ABA handbook) ────────────────────
  {
    factor: 'elderly',
    jurisdiction: 'GLOBAL',
    safeguards: ['simplified-language', 'larger-text', 'cooling-off-extension'],
    source: 'ABA Tenant Vulnerability Handbook (2021)',
    reason: 'Elderly tenants — larger text + extended cooling-off period.',
  },
  {
    factor: 'elderly',
    jurisdiction: 'TZ',
    safeguards: ['advocacy-contact', 'in-person-only'],
    source: 'TZ Land Act 1999 § 30',
    reason: 'TZ Land Act § 30 — special protection on land transactions.',
  },
  // ── Disabled ────────────────────────────────────────────────────────
  {
    factor: 'disabled',
    jurisdiction: 'GLOBAL',
    safeguards: ['larger-text', 'audio-summary', 'mandatory-explanation'],
    source: 'UN Convention on Rights of Persons with Disabilities (CRPD, 2006)',
    reason: 'Reasonable accommodation per CRPD Art. 9 (Accessibility).',
  },
  {
    factor: 'disabled',
    jurisdiction: 'TZ',
    safeguards: ['advocacy-contact'],
    source: 'TZ Persons with Disabilities Act 2010 §§ 30–35',
    reason: 'TZ PWDA — disability advocacy contact mandatory.',
  },
  {
    factor: 'disabled',
    jurisdiction: 'KE',
    safeguards: ['advocacy-contact'],
    source: 'KE Persons with Disabilities Act 2003',
    reason: 'KE PWDA 2003 — disability rights officer contact.',
  },
  {
    factor: 'disabled',
    jurisdiction: 'US',
    safeguards: ['advocacy-contact', 'no-automated-decision'],
    source: 'ADA (1990) + FHA § 804(f)',
    reason: 'ADA reasonable-modification + FHA — disability protection.',
  },
  // ── Displaced / refugees ────────────────────────────────────────────
  {
    factor: 'displaced',
    jurisdiction: 'GLOBAL',
    safeguards: ['translator', 'simplified-language', 'advocacy-contact'],
    source: 'UNHCR Guidelines on the Protection of Refugees',
    reason: 'Displaced person — language access + advocacy contact.',
  },
  {
    factor: 'refugee',
    jurisdiction: 'GLOBAL',
    safeguards: ['translator', 'in-person-only', 'advocacy-contact'],
    source: '1951 Refugee Convention + 1967 Protocol',
    reason: 'Refugee — in-person verification due to ID complexity.',
  },
  // ── Victim of violence ──────────────────────────────────────────────
  {
    factor: 'victim-of-violence',
    jurisdiction: 'GLOBAL',
    safeguards: ['no-marketing', 'no-automated-decision', 'in-person-only'],
    source: 'Istanbul Convention (CoE 2011), Art. 18',
    reason: 'Survivor — restrict outbound contact + manual review only.',
  },
  {
    factor: 'victim-of-violence',
    jurisdiction: 'US',
    safeguards: ['advocacy-contact', 'mandatory-explanation'],
    source: 'VAWA (Violence Against Women Reauthorization Act 2022)',
    reason: 'VAWA — survivor confidentiality + advocacy referral.',
  },
  // ── Language barrier ────────────────────────────────────────────────
  {
    factor: 'language-barrier',
    jurisdiction: 'GLOBAL',
    safeguards: ['translator', 'simplified-language', 'audio-summary'],
    source: 'ICCPR Art. 27 (linguistic minorities)',
    reason: 'Language barrier — translator + simplified text + audio.',
  },
  // ── Low literacy ────────────────────────────────────────────────────
  {
    factor: 'low-literacy',
    jurisdiction: 'GLOBAL',
    safeguards: ['simplified-language', 'audio-summary', 'extra-confirmation'],
    source: 'UNESCO Adult Literacy Strategy',
    reason: 'Low literacy — audio + simplified + extra-confirmation step.',
  },
  // ── Recent bereavement ──────────────────────────────────────────────
  {
    factor: 'recent-bereavement',
    jurisdiction: 'GLOBAL',
    safeguards: ['cooling-off-extension', 'no-marketing'],
    source: 'ABA Tenant Vulnerability Handbook',
    reason: 'Recent bereavement — pause marketing + extend cooling-off.',
  },
  // ── Pregnant ────────────────────────────────────────────────────────
  {
    factor: 'pregnant',
    jurisdiction: 'GLOBAL',
    safeguards: ['no-automated-decision'],
    source: 'FHA Familial Status (Title VIII as amended 1988)',
    reason: 'Pregnancy — fair-housing protection against automated discrimination.',
  },
  // ── Caregiver of dependent ──────────────────────────────────────────
  {
    factor: 'caregiver-of-dependent',
    jurisdiction: 'GLOBAL',
    safeguards: ['cooling-off-extension'],
    source: 'ABA Tenant Vulnerability Handbook',
    reason: 'Sole caregiver — extended cooling-off recommended.',
  },
  // ── Survivor of eviction ────────────────────────────────────────────
  {
    factor: 'survivor-of-eviction',
    jurisdiction: 'GLOBAL',
    safeguards: ['advocacy-contact', 'mandatory-explanation'],
    source: 'HUD Eviction Protection Program guidance (2022)',
    reason: 'Eviction history — mandatory human explanation + advocacy.',
  },
]);

/**
 * Returns the safeguards applicable to a subject with given factors in
 * a given jurisdiction. Deduplicated by `kind`; if the same kind is
 * supplied by both a GLOBAL rule and a jurisdiction-specific rule the
 * jurisdiction-specific rule wins (more specific source).
 */
export function safeguardsFor(args: {
  factors: ReadonlyArray<VulnerabilityFactor>;
  jurisdiction: Jurisdiction;
}): ReadonlyArray<Safeguard> {
  const applicable: SafeguardRule[] = [];
  for (const rule of RULES) {
    if (!args.factors.includes(rule.factor)) continue;
    if (rule.jurisdiction !== 'GLOBAL' && rule.jurisdiction !== args.jurisdiction) continue;
    applicable.push(rule);
  }
  // Dedupe by kind, jurisdiction-specific wins.
  const seen = new Map<SafeguardKind, Safeguard>();
  for (const rule of applicable) {
    for (const kind of rule.safeguards) {
      const existing = seen.get(kind);
      const candidate: Safeguard = {
        kind,
        reason: rule.reason,
        jurisdiction: rule.jurisdiction,
        source: rule.source,
      };
      if (!existing) {
        seen.set(kind, candidate);
        continue;
      }
      // jurisdiction-specific wins over GLOBAL.
      if (existing.jurisdiction === 'GLOBAL' && rule.jurisdiction !== 'GLOBAL') {
        seen.set(kind, candidate);
      }
    }
  }
  return Array.from(seen.values());
}

export const VULNERABILITY_RULES_FOR_TEST = RULES;
