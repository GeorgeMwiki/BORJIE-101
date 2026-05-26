/**
 * English mining-domain glossary (UNIV-2).
 *
 * Cross-jurisdictional baseline. Tanzanian terms are tagged 'TZ',
 * cross-border industry-standard terms carry no region tag. Every
 * entry cites its primary source.
 *
 * Sources:
 *   - The Mining Act, Cap.123 (consolidated to 2025, Tume ya Madini)
 *     https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf
 *     (accessed 2026-05-26)
 *   - Tume ya Madini — official website
 *     https://www.tumemadini.go.tz/ (accessed 2026-05-26)
 *   - Tanzania Revenue Authority
 *     https://www.tra.go.tz/ (accessed 2026-05-26)
 *   - ICMM (International Council on Mining and Metals)
 *     https://www.icmm.com/ (accessed 2026-05-26)
 *   - IRMA (Initiative for Responsible Mining Assurance)
 *     https://responsiblemining.net/ (accessed 2026-05-26)
 */

import type { Citation } from '@borjie/language-packs';
import type { MiningGlossaryEntry } from './types.js';

const ACCESSED = '2026-05-26';

const MINING_ACT: Citation = Object.freeze({
  url: 'https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf',
  title: 'The Mining Act, Cap.123 (Tanzania, 2025 consolidation)',
  accessedAt: ACCESSED,
});

const TUMEMADINI: Citation = Object.freeze({
  url: 'https://www.tumemadini.go.tz/',
  title: 'Tume ya Madini (Mining Commission of Tanzania)',
  accessedAt: ACCESSED,
});

const TRA: Citation = Object.freeze({
  url: 'https://www.tra.go.tz/',
  title: 'Tanzania Revenue Authority',
  accessedAt: ACCESSED,
});

const ICMM: Citation = Object.freeze({
  url: 'https://www.icmm.com/',
  title: 'International Council on Mining and Metals',
  accessedAt: ACCESSED,
});

const IRMA: Citation = Object.freeze({
  url: 'https://responsiblemining.net/',
  title: 'Initiative for Responsible Mining Assurance',
  accessedAt: ACCESSED,
});

function entry(p: MiningGlossaryEntry): MiningGlossaryEntry {
  return Object.freeze(p);
}

export const EN_MINING_GLOSSARY: ReadonlyArray<MiningGlossaryEntry> =
  Object.freeze([
    entry({
      term: 'royalty',
      lemma: 'royalty',
      enEquivalent: 'royalty',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        en: 'A payment to government computed on the gross value of minerals produced.',
        localised: null,
      }),
      citation: TUMEMADINI,
    }),
    entry({
      term: 'inspection fee',
      lemma: 'inspection fee',
      enEquivalent: 'inspection fee',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        en: 'A statutory fee charged alongside royalty by Tume ya Madini.',
        localised: null,
      }),
      citation: TUMEMADINI,
    }),
    entry({
      term: 'Primary Mining Licence',
      lemma: 'PML',
      enEquivalent: 'Primary Mining Licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'A small-scale mining licence in Tanzania issued for up to seven years (Mining Act Cap.123).',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'Mining Licence',
      lemma: 'ML',
      enEquivalent: 'Mining Licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'A medium-scale mining licence in Tanzania issued for up to ten years.',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'Special Mining Licence',
      lemma: 'SML',
      enEquivalent: 'Special Mining Licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'A large-scale mining licence in Tanzania for large-capex projects.',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'Prospecting Licence',
      lemma: 'PL',
      enEquivalent: 'Prospecting Licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'A licence to prospect for minerals in Tanzania, up to four years.',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'mining permit',
      lemma: 'permit',
      enEquivalent: 'mining permit',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'Authorisation permitting mining activity in a designated area.',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'dealer licence',
      lemma: 'dealer licence',
      enEquivalent: 'dealer licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        en: 'A licence to trade in minerals.',
        localised: null,
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'gross value',
      lemma: 'gross value',
      enEquivalent: 'gross value',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        en: 'The determined market value of minerals at the point of valuation.',
        localised: null,
      }),
      citation: TUMEMADINI,
    }),
    entry({
      term: 'tax',
      lemma: 'tax',
      enEquivalent: 'tax',
      domain: 'tax',
      register: 'formal',
      definition: Object.freeze({
        en: 'A mandatory monetary contribution to government revenue.',
        localised: null,
      }),
      citation: TRA,
    }),
    entry({
      term: 'environmental impact assessment',
      lemma: 'EIA',
      enEquivalent: 'EIA',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        en: 'A statutory assessment of the environmental consequences of a mining project.',
        localised: null,
      }),
      citation: ICMM,
    }),
    entry({
      term: 'social licence to operate',
      lemma: 'SLO',
      enEquivalent: 'SLO',
      domain: 'csr',
      register: 'formal',
      definition: Object.freeze({
        en: 'The ongoing acceptance of mining operations by local communities and broader society.',
        localised: null,
      }),
      citation: IRMA,
    }),
  ]);

if (EN_MINING_GLOSSARY.length < 10) {
  throw new Error(
    `EN_MINING_GLOSSARY: expected ≥10 entries, got ${EN_MINING_GLOSSARY.length}`,
  );
}

export function findEnMiningTerm(
  term: string,
): MiningGlossaryEntry | null {
  const needle = term.trim().toLowerCase();
  for (const e of EN_MINING_GLOSSARY) {
    if (e.term.toLowerCase() === needle || e.lemma.toLowerCase() === needle) {
      return e;
    }
  }
  return null;
}
