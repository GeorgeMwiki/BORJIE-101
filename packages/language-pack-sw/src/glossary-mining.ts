/**
 * Swahili mining-domain glossary (UNIV-2).
 *
 * 50 entries spanning licensing, royalty + tax, regulators, operations,
 * processing, health & safety, environment and community engagement.
 * Every entry carries a primary-source citation URL + title + accessed
 * date.
 *
 * Primary sources:
 *   - Tume ya Madini official website
 *     https://www.tumemadini.go.tz/ (accessed 2026-05-26)
 *   - Mineral Royalties and Inspection Fee Rates (Tumemadini)
 *     https://www.tumemadini.go.tz/pages/mineral-royalties-and-inspection-fees-rates/
 *     (accessed 2026-05-26)
 *   - Mining (Mineral Rights) Regulations — GN. No. 1 (Ministry of Minerals)
 *     https://www.madini.go.tz/media/GN_MINERAL_RIGHTS-REGULATIONS-C_6__CHAPA_GN._1.pdf
 *     (accessed 2026-05-26)
 *   - The Mining Act, Cap.123 (consolidated to 2025)
 *     https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf
 *     (accessed 2026-05-26)
 *   - Ministry of Minerals — Republic of Tanzania
 *     https://www.madini.go.tz/ (accessed 2026-05-26)
 *   - Tanzania Revenue Authority
 *     https://www.tra.go.tz/ (accessed 2026-05-26)
 *   - NEMC — National Environment Management Council
 *     https://www.nemc.or.tz/ (accessed 2026-05-26)
 *   - Clyde & Co — Tanzania mining technical-support regulations 2025
 *     https://www.clydeco.com/en/insights/2025/05/tanzania-enacts-mining-technical-support
 *     (accessed 2026-05-26)
 *
 * Coverage cross-references the Swahili-linguistics package's
 * mining-terms seed (Wave 19H) so the two glossaries stay
 * compatible.
 */

import type { Citation } from '@borjie/language-packs';
import type { SwMiningGlossaryEntry } from './types.js';

const ACCESSED = '2026-05-26';

const TUMEMADINI: Citation = Object.freeze({
  url: 'https://www.tumemadini.go.tz/',
  title: 'Tume ya Madini — official website',
  accessedAt: ACCESSED,
});

const TUMEMADINI_ROYALTY: Citation = Object.freeze({
  url: 'https://www.tumemadini.go.tz/pages/mineral-royalties-and-inspection-fees-rates/',
  title: 'Mineral Royalties and Inspection Fee Rates — Tume ya Madini',
  accessedAt: ACCESSED,
});

const MADINI_REGS: Citation = Object.freeze({
  url: 'https://www.madini.go.tz/media/GN_MINERAL_RIGHTS-REGULATIONS-C_6__CHAPA_GN._1.pdf',
  title: 'Mining (Mineral Rights) Regulations — GN. No. 1',
  accessedAt: ACCESSED,
});

const MINING_ACT: Citation = Object.freeze({
  url: 'https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf',
  title: 'The Mining Act, Cap.123 (2025 consolidation)',
  accessedAt: ACCESSED,
});

const MADINI_MIN: Citation = Object.freeze({
  url: 'https://www.madini.go.tz/',
  title: 'Ministry of Minerals — Republic of Tanzania',
  accessedAt: ACCESSED,
});

const TRA: Citation = Object.freeze({
  url: 'https://www.tra.go.tz/',
  title: 'Tanzania Revenue Authority',
  accessedAt: ACCESSED,
});

const NEMC: Citation = Object.freeze({
  url: 'https://www.nemc.or.tz/',
  title: 'NEMC — National Environment Management Council',
  accessedAt: ACCESSED,
});

const CLYDECO_2025: Citation = Object.freeze({
  url: 'https://www.clydeco.com/en/insights/2025/05/tanzania-enacts-mining-technical-support',
  title: 'Tanzania Enacts the Mining (Technical Support to Small Scale Miners) Regulations, 2025',
  accessedAt: ACCESSED,
});

function entry(p: SwMiningGlossaryEntry): SwMiningGlossaryEntry {
  return Object.freeze(p);
}

export const SW_MINING_GLOSSARY: ReadonlyArray<SwMiningGlossaryEntry> =
  Object.freeze([
    // ---------- Regulators (5) ----------
    entry({
      term: 'Tume ya Madini',
      lemma: 'Tume ya Madini',
      enEquivalent: 'Mining Commission',
      domain: 'regulator',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Taasisi ya serikali inayoidhinisha leseni za madini Tanzania.',
        en: 'Statutory body that issues and regulates mining licences in Tanzania.',
      }),
      citation: TUMEMADINI,
    }),
    entry({
      term: 'Wizara ya Madini',
      lemma: 'Wizara ya Madini',
      enEquivalent: 'Ministry of Minerals',
      domain: 'regulator',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Wizara ya serikali ya Tanzania inayohusika na sekta ya madini.',
        en: 'Government ministry responsible for the minerals sector.',
      }),
      citation: MADINI_MIN,
    }),
    entry({
      term: 'TRA',
      lemma: 'TRA',
      enEquivalent: 'Tanzania Revenue Authority',
      domain: 'regulator',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mamlaka ya Mapato Tanzania.',
        en: 'Tax authority collecting royalties, inspection fees and corporate tax.',
      }),
      citation: TRA,
    }),
    entry({
      term: 'NEMC',
      lemma: 'NEMC',
      enEquivalent: 'National Environment Management Council',
      domain: 'regulator',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Baraza la usimamizi wa mazingira Tanzania.',
        en: 'Tanzanian environmental regulator.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'BoT',
      lemma: 'BoT',
      enEquivalent: 'Bank of Tanzania',
      domain: 'regulator',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Benki Kuu ya Tanzania.',
        en: 'Central bank of Tanzania.',
      }),
      citation: TUMEMADINI,
    }),

    // ---------- Licensing (10) ----------
    entry({
      term: 'leseni ya uchimbaji mdogo',
      lemma: 'leseni',
      enEquivalent: 'Primary Mining Licence (PML)',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Leseni ya uchimbaji mdogo inayotolewa kwa kipindi kisichozidi miaka saba.',
        en: 'Small-scale mining licence issued for up to seven years.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'leseni ya uchimbaji wa kati',
      lemma: 'leseni',
      enEquivalent: 'Medium-scale Mining Licence (ML)',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Leseni ya uchimbaji wa kati inayotolewa kwa kipindi kisichozidi miaka kumi.',
        en: 'Medium-scale mining licence issued for up to ten years.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'leseni ya uchimbaji mkubwa',
      lemma: 'leseni',
      enEquivalent: 'Special Mining Licence (SML)',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Leseni ya uchimbaji mkubwa kwa miradi yenye uwekezaji mkubwa.',
        en: 'Large-scale mining licence for large-capex projects.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'leseni ya utafutaji',
      lemma: 'leseni',
      enEquivalent: 'Prospecting Licence (PL)',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Leseni ya utafutaji wa madini, isiyozidi miaka minne.',
        en: 'Prospecting licence; up to four years.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'kibali cha uchimbaji',
      lemma: 'kibali',
      enEquivalent: 'mining permit',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Hati maalum inayoruhusu uchimbaji wa madini katika eneo lililoteuliwa.',
        en: 'Authorisation permitting mining in a designated area.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'kibali cha biashara',
      lemma: 'kibali',
      enEquivalent: 'dealer licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kibali cha kufanya biashara ya madini.',
        en: 'Licence to trade in minerals.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'kibali cha uchakataji',
      lemma: 'kibali',
      enEquivalent: 'processing permit',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kibali cha uchakataji wa madini.',
        en: 'Permit for mineral processing.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'leseni ya muda',
      lemma: 'leseni',
      enEquivalent: 'temporary licence',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Leseni ya kipindi kifupi inayotolewa kabla ya leseni ya kudumu.',
        en: 'Short-term licence issued pending a permanent licence.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'kibali cha usafirishaji',
      lemma: 'kibali',
      enEquivalent: 'export permit',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kibali cha kusafirisha madini nje ya nchi.',
        en: 'Permit authorising export of minerals.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'eneo la leseni',
      lemma: 'eneo',
      enEquivalent: 'licence area',
      domain: 'licensing',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Eneo la kijiografia lililofunikwa na leseni husika.',
        en: 'Geographic extent covered by a given mining licence.',
      }),
      citation: MINING_ACT,
    }),

    // ---------- Royalty + tax (8) ----------
    entry({
      term: 'mrabaha',
      lemma: 'mrabaha',
      enEquivalent: 'royalty',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Malipo kwa serikali kutokana na thamani ya madini.',
        en: 'Payment to government based on the gross value of minerals.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'ada ya ukaguzi',
      lemma: 'ada',
      enEquivalent: 'inspection fee',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Tozo ya ukaguzi inayolipwa pamoja na mrabaha.',
        en: 'Inspection fee charged alongside royalty.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'thamani ya jumla',
      lemma: 'thamani',
      enEquivalent: 'gross value',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Thamani ya soko ya madini iliyobainishwa.',
        en: 'Determined market value of minerals.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'kodi',
      lemma: 'kodi',
      enEquivalent: 'tax',
      domain: 'tax',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Malipo ya lazima kwa serikali.',
        en: 'Mandatory tax payment.',
      }),
      citation: TRA,
    }),
    entry({
      term: 'kodi ya mapato ya kampuni',
      lemma: 'kodi',
      enEquivalent: 'corporate income tax',
      domain: 'tax',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kodi inayolipwa na kampuni kutokana na faida.',
        en: 'Tax on company profits.',
      }),
      citation: TRA,
    }),
    entry({
      term: 'VAT',
      lemma: 'VAT',
      enEquivalent: 'value-added tax',
      domain: 'tax',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kodi ya thamani ya ongezeko inayotozwa katika bei ya bidhaa au huduma.',
        en: 'Value-added tax charged on goods and services.',
      }),
      citation: TRA,
    }),
    entry({
      term: 'ada ya mwaka',
      lemma: 'ada',
      enEquivalent: 'annual fee',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Ada inayolipwa kila mwaka kwa kudumisha leseni.',
        en: 'Annual fee payable to retain a mining licence.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'asilimia ya mrabaha',
      lemma: 'mrabaha',
      enEquivalent: 'royalty rate',
      domain: 'royalty',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kiwango cha asilimia kinachotumika kuhesabu mrabaha kwa kila aina ya madini.',
        en: 'Percentage rate applied to compute royalty per mineral category.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),

    // ---------- Operations (10) ----------
    entry({
      term: 'mchimbaji',
      lemma: 'mchimbaji',
      enEquivalent: 'miner',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mtu au taasisi inayofanya shughuli za uchimbaji wa madini.',
        en: 'Individual or entity engaged in mineral extraction.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'mchimbaji mdogo',
      lemma: 'mchimbaji',
      enEquivalent: 'small-scale miner',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mchimbaji anayefanya kazi chini ya leseni ya uchimbaji mdogo (PML).',
        en: 'Small-scale miner operating under a PML.',
      }),
      citation: CLYDECO_2025,
    }),
    entry({
      term: 'madini',
      lemma: 'madini',
      enEquivalent: 'minerals',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Vitu vya asili vinavyochimbwa chini ya ardhi.',
        en: 'Naturally occurring substances extracted from the earth.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'mgodi',
      lemma: 'mgodi',
      enEquivalent: 'mine',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Eneo la uchimbaji wa madini.',
        en: 'Site of mineral extraction.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'uchimbaji',
      lemma: 'uchimbaji',
      enEquivalent: 'mining',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Shughuli ya kuchukua madini kutoka ardhini.',
        en: 'The activity of extracting minerals from the earth.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'uchakataji',
      lemma: 'uchakataji',
      enEquivalent: 'processing',
      domain: 'operations',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Hatua ya kubadilisha madini ghafi kuwa bidhaa za thamani zaidi.',
        en: 'Transforming raw ore into higher-value mineral products.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'dhahabu',
      lemma: 'dhahabu',
      enEquivalent: 'gold',
      domain: 'commodity',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Madini ya thamani ya rangi ya manjano.',
        en: 'Precious yellow metal.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'tanzanite',
      lemma: 'tanzanite',
      enEquivalent: 'tanzanite',
      domain: 'commodity',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Madini ya thamani ya rangi ya bluu yanayopatikana Tanzania.',
        en: 'Blue gemstone found only in Tanzania.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'shaba',
      lemma: 'shaba',
      enEquivalent: 'copper',
      domain: 'commodity',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Madini ya rangi ya hudhurungi yanayotumika katika viwanda.',
        en: 'Reddish-brown industrial metal.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),
    entry({
      term: 'almasi',
      lemma: 'almasi',
      enEquivalent: 'diamond',
      domain: 'commodity',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Madini ya thamani ya juu yenye nguvu na uangavu.',
        en: 'Precious crystalline carbon gemstone.',
      }),
      citation: TUMEMADINI_ROYALTY,
    }),

    // ---------- Safety + environment (10) ----------
    entry({
      term: 'usalama',
      lemma: 'usalama',
      enEquivalent: 'safety',
      domain: 'safety',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Hali ya kuhakikisha hakuna madhara kwa wafanyakazi.',
        en: 'State of ensuring no harm to workers.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'afya kazini',
      lemma: 'afya',
      enEquivalent: 'occupational health',
      domain: 'safety',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Hali ya afya ya wafanyakazi mahali pa kazi.',
        en: 'Worker health status in the workplace.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'ajali',
      lemma: 'ajali',
      enEquivalent: 'accident',
      domain: 'safety',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Tukio lisilotarajiwa linalosababisha madhara.',
        en: 'Unplanned event causing harm or damage.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'mazingira',
      lemma: 'mazingira',
      enEquivalent: 'environment',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mazingira yanayozunguka eneo la mgodi.',
        en: 'Surroundings of a mining operation.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'tathmini ya athari za mazingira',
      lemma: 'tathmini',
      enEquivalent: 'environmental impact assessment (EIA)',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Uchambuzi wa athari za mradi wa madini kwa mazingira.',
        en: 'Statutory assessment of the environmental consequences of a mining project.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'urejeshaji wa eneo',
      lemma: 'urejeshaji',
      enEquivalent: 'site rehabilitation',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kurudisha eneo la mgodi katika hali yake ya asili baada ya uchimbaji.',
        en: 'Restoring a mined site to its pre-mining condition.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'uchafuzi wa maji',
      lemma: 'uchafuzi',
      enEquivalent: 'water pollution',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kuingia kwa kemikali au taka kwenye maji.',
        en: 'Contamination of water by chemicals or waste.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'taka za mgodi',
      lemma: 'taka',
      enEquivalent: 'mine tailings / waste',
      domain: 'environment',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mabaki ya uchimbaji yanayopaswa kushughulikiwa kwa usalama.',
        en: 'Residual material from mining operations requiring safe management.',
      }),
      citation: NEMC,
    }),
    entry({
      term: 'jamii ya mtaa',
      lemma: 'jamii',
      enEquivalent: 'local community',
      domain: 'csr',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Watu wanaoishi karibu na eneo la mgodi.',
        en: 'People residing near a mining site.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'ushiriki wa jamii',
      lemma: 'ushiriki',
      enEquivalent: 'community engagement',
      domain: 'csr',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mchakato wa kushirikiana na jamii kuhusu mradi.',
        en: 'Process of engaging communities about a project.',
      }),
      citation: MINING_ACT,
    }),

    // ---------- Geology (5) ----------
    entry({
      term: 'jiolojia',
      lemma: 'jiolojia',
      enEquivalent: 'geology',
      domain: 'geology',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Sayansi ya muundo wa dunia.',
        en: 'The science of the structure of the earth.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'mwamba',
      lemma: 'mwamba',
      enEquivalent: 'rock',
      domain: 'geology',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Mkusanyiko mgumu wa madini.',
        en: 'Solid aggregation of minerals.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'akiba ya madini',
      lemma: 'akiba',
      enEquivalent: 'mineral reserves',
      domain: 'geology',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Kiasi cha madini kilichothibitishwa kuwepo na kuchimbika.',
        en: 'Verified quantity of mineable mineral resources.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'kiwango cha thamani',
      lemma: 'kiwango',
      enEquivalent: 'ore grade',
      domain: 'geology',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Asilimia ya madini ya thamani katika sampuli ya ardhi.',
        en: 'Percentage of valuable mineral content in an ore sample.',
      }),
      citation: MINING_ACT,
    }),
    entry({
      term: 'sampuli',
      lemma: 'sampuli',
      enEquivalent: 'sample',
      domain: 'geology',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Sehemu ndogo ya mwamba inayotumika kwa uchambuzi.',
        en: 'Small portion of rock used for analysis.',
      }),
      citation: MINING_ACT,
    }),

    // ---------- Reporting (2) ----------
    entry({
      term: 'ripoti ya uzalishaji',
      lemma: 'ripoti',
      enEquivalent: 'production report',
      domain: 'reporting',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Ripoti rasmi inayoonyesha kiasi cha madini yaliyozalishwa.',
        en: 'Formal report stating mineral production volumes.',
      }),
      citation: MADINI_REGS,
    }),
    entry({
      term: 'ripoti ya kifedha',
      lemma: 'ripoti',
      enEquivalent: 'financial report',
      domain: 'reporting',
      register: 'formal',
      definition: Object.freeze({
        sw: 'Ripoti rasmi inayoonyesha hali ya kifedha ya kampuni.',
        en: 'Formal statement of a company financial position.',
      }),
      citation: TRA,
    }),
  ]);

if (SW_MINING_GLOSSARY.length !== 50) {
  throw new Error(
    `SW_MINING_GLOSSARY: expected exactly 50 entries, got ${SW_MINING_GLOSSARY.length}`,
  );
}

export function findSwMiningTerm(
  term: string,
): SwMiningGlossaryEntry | null {
  const needle = term.trim().toLowerCase();
  for (const e of SW_MINING_GLOSSARY) {
    if (e.term.toLowerCase() === needle || e.lemma.toLowerCase() === needle) {
      return e;
    }
  }
  return null;
}
