/**
 * Mining-vocabulary glossary.
 *
 * Borjie-era replacement for the legacy BossNyumba estate translations.
 * Every term carries an English canonical form, Swahili (sw), and the
 * priority Tanzanian-mining locales (where curated). Domain coverage:
 * shaft / drill / ore / assay / fingerprint / licence / gold-window /
 * royalty plus core operating vocabulary.
 *
 * Where a Tanzanian Swahili term is the canonical mining word
 * (e.g. "mwanzo", "mkulima", "mfanyabiashara", "kampuni") we keep the
 * Swahili term verbatim and document its meaning in `notes`.
 *
 * Citations refer to Tanzanian statutes where stable:
 *   - The Mining Act, 2010 (Cap 123) and 2017 amendments.
 *   - The Mining (Mineral Rights) Regulations, 2018.
 *   - Bank of Tanzania circulars on the gold-window export licence.
 */

import { buildEntries, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'mining.shaft',
    en: 'shaft',
    def: 'A vertical or steeply inclined excavation providing access to underground workings.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'kisima cha mgodi',
      fr: 'puits de mine',
      de: 'Schacht',
    },
  },
  {
    id: 'mining.drill',
    en: 'drill',
    def: 'A machine for boring holes into rock to extract samples or place explosives.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'kichimba mawe',
      fr: 'foreuse',
      de: 'Bohrmaschine',
    },
    notes: 'In Tanzanian field reports the verb form "kuchimba" is also used colloquially.',
  },
  {
    id: 'mining.drill_hole',
    en: 'drill hole',
    def: 'A bored hole used for sample collection or blast preparation.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'AU'],
    t: {
      sw: 'shimo la kuchimba',
    },
  },
  {
    id: 'mining.ore',
    en: 'ore',
    def: 'Naturally occurring rock or sediment from which a valuable mineral can be economically extracted.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'madini ghafi',
      fr: 'minerai',
      de: 'Erz',
    },
  },
  {
    id: 'mining.tailings',
    en: 'tailings',
    def: 'The residue left after the economically valuable fraction has been separated from the ore.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'mabaki ya kusagia',
      fr: 'résidus miniers',
      de: 'Bergematerial',
    },
  },
  {
    id: 'mining.assay',
    en: 'assay',
    def: 'Quantitative analysis determining the metal content of an ore or concentrate sample.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'uchunguzi wa madini',
      fr: 'analyse de minerai',
      de: 'Erzanalyse',
    },
  },
  {
    id: 'mining.assay_lab',
    en: 'assay laboratory',
    def: 'Accredited facility performing fire-assay or XRF analysis on ore and concentrate samples.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'maabara ya uchunguzi wa madini',
    },
  },
  {
    id: 'mining.fingerprint',
    en: 'fingerprint',
    def: 'Biometric identifier captured to sign off shift events, sample chain-of-custody, and toolbox talks.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'alama ya kidole',
      fr: 'empreinte digitale',
      de: 'Fingerabdruck',
    },
  },
  {
    id: 'mining.licence',
    en: 'mining licence',
    def: 'Statutory authority to prospect for, mine, or process minerals within a defined area.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'leseni ya madini',
      fr: 'permis minier',
      de: 'Bergbaulizenz',
    },
    cite: {
      jurisdiction: 'TZ',
      statuteRef: 'Mining Act',
      section: 's.7',
      year: 2010,
    },
  },
  {
    id: 'mining.pml',
    en: 'Primary Mining Licence (PML)',
    def: 'Tanzanian licence class reserved for Tanzanian-citizen artisanal and small-scale miners.',
    cat: 'legal_proceedings',
    juris: ['TZ'],
    t: {
      sw: 'leseni ya msingi ya uchimbaji (PML)',
    },
    cite: {
      jurisdiction: 'TZ',
      statuteRef: 'Mining Act',
      section: 's.8',
      year: 2010,
    },
    notes: 'Issued by the Mining Commission; renewable; site-specific.',
    syn: ['PML'],
  },
  {
    id: 'mining.licence_renewal',
    en: 'licence renewal',
    def: 'Statutory process for extending the validity of a mining licence beyond its expiry.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'GH'],
    t: {
      sw: 'kuongezwa kwa leseni',
    },
  },
  {
    id: 'mining.gold_window',
    en: 'gold window',
    def: 'The Bank of Tanzania-administered buying-and-export channel for refined gold from licensed Tanzanian miners.',
    cat: 'finance',
    juris: ['TZ'],
    t: {
      sw: 'dirisha la dhahabu',
    },
    notes: 'Operationalised by BoT circulars on gold purchase and FX settlement.',
  },
  {
    id: 'mining.royalty',
    en: 'royalty',
    def: 'A statutory levy payable to the State on the gross value of minerals produced.',
    cat: 'finance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'mrabaha',
      fr: 'redevance minière',
      de: 'Bergbauabgabe',
    },
    cite: {
      jurisdiction: 'TZ',
      statuteRef: 'Mining Act',
      section: 's.87',
      year: 2010,
    },
  },
  {
    id: 'mining.export_levy',
    en: 'mineral export levy',
    def: 'Statutory levy on exported minerals additional to royalty.',
    cat: 'finance',
    juris: ['TZ', 'GH'],
    t: {
      sw: 'ushuru wa mauzo ya nje ya madini',
    },
  },
  {
    id: 'mining.weighbridge',
    en: 'weighbridge',
    def: 'Calibrated scale for weighing trucks of ore in and out of a site for inventory and tax purposes.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH'],
    t: {
      sw: 'mizani',
      fr: 'pont-bascule',
      de: 'Fahrzeugwaage',
    },
  },
  {
    id: 'mining.shift_report',
    en: 'shift report',
    def: 'End-of-shift record of workers, hours, fuel, equipment use, blockers and incidents.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH'],
    t: {
      sw: 'ripoti ya shifti',
    },
  },
  {
    id: 'mining.toolbox_talk',
    en: 'toolbox talk',
    def: 'Pre-shift safety briefing acknowledged by each worker (often by fingerprint).',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'mazungumzo ya usalama kabla ya shifti',
    },
  },
  {
    id: 'mining.ehs',
    en: 'environment, health and safety (EHS)',
    def: 'Cross-cutting domain of statutory obligations on mine environmental impact and worker safety.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'mazingira, afya na usalama',
    },
  },
  {
    id: 'mining.fuel_log',
    en: 'fuel log',
    def: 'Per-asset record of fuel issued to excavators, trucks, generators and other equipment.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH'],
    t: {
      sw: 'kumbukumbu ya mafuta',
    },
  },
  {
    id: 'mining.sample_tag',
    en: 'sample tag',
    def: 'Tamper-evident tag identifying a drill or grab sample through the chain of custody.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH'],
    t: {
      sw: 'kitambulisho cha sampuli',
    },
  },
  {
    id: 'mining.chain_of_custody',
    en: 'chain of custody',
    def: 'Documented sequence of handovers tracking each sample from drill hole to assay lab.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'mlolongo wa udhibiti',
    },
  },
  {
    id: 'mining.geofence',
    en: 'site geofence',
    def: 'Bounded GPS area defining the legal mine perimeter; used for attendance and ore-movement checks.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'mpaka wa GPS wa mgodi',
    },
  },
  {
    id: 'mining.cliff_status',
    en: 'cliff status',
    def: 'Operator-facing summary of how many days remain before a regulatory or financial cliff date.',
    cat: 'compliance',
    juris: ['TZ'],
    t: {
      sw: 'hali ya tarehe ya mwisho',
    },
  },
  {
    id: 'mining.actor.mwanzo',
    en: 'mwanzo',
    def: 'Pioneer artisanal miner; the original prospector on a deposit.',
    cat: 'hr',
    juris: ['TZ'],
    t: {
      sw: 'mwanzo',
    },
    notes:
      'Swahili "mwanzo" (beginning / origin) — retained verbatim in Borjie field vocabulary for the pioneer miner on a PML site.',
  },
  {
    id: 'mining.actor.mkulima',
    en: 'mkulima',
    def: 'Swahili "farmer" — used in Borjie for a smallholder whose plot abuts or overlaps with a PML.',
    cat: 'hr',
    juris: ['TZ'],
    t: {
      sw: 'mkulima',
    },
    notes:
      'Swahili "mkulima" retained verbatim. Relevant for community-engagement and land-use conflict resolution.',
  },
  {
    id: 'mining.actor.mfanyabiashara',
    en: 'mfanyabiashara',
    def: 'Mineral trader or buyer; intermediary between the artisanal miner and refiners / exporters.',
    cat: 'finance',
    juris: ['TZ'],
    t: {
      sw: 'mfanyabiashara',
    },
    notes:
      'Swahili "mfanyabiashara" (businessperson) retained verbatim — the canonical term for licensed mineral dealers.',
  },
  {
    id: 'mining.actor.kampuni',
    en: 'kampuni',
    def: 'Swahili-loan word for "company"; in Borjie used for the licensed mining or processing entity.',
    cat: 'hr',
    juris: ['TZ'],
    t: {
      sw: 'kampuni',
    },
    notes:
      'Swahili loan from English "company" — retained verbatim across all Tanzanian-mining surfaces.',
  },
  {
    id: 'mining.mineral.gold',
    en: 'gold',
    def: 'Primary mineral commodity governed by the gold-window export regime.',
    cat: 'finance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: {
      sw: 'dhahabu',
      fr: 'or',
      de: 'Gold',
    },
  },
  {
    id: 'mining.mineral.tanzanite',
    en: 'tanzanite',
    def: 'Blue gem variety of zoisite, mined exclusively in the Mererani area of northern Tanzania.',
    cat: 'finance',
    juris: ['TZ'],
    t: {
      sw: 'tanzanite',
    },
    notes: 'Geographic-indication mineral; Mererani exports follow a dedicated channel.',
  },
  {
    id: 'mining.mineral.copper',
    en: 'copper',
    def: 'Industrial base metal mined as sulphide or oxide ore.',
    cat: 'finance',
    juris: ['TZ', 'ZM', 'CD'],
    t: {
      sw: 'shaba',
      fr: 'cuivre',
      de: 'Kupfer',
    },
  },
  {
    id: 'mining.mineral.diamond',
    en: 'diamond',
    def: 'Industrial / gem mineral mined principally at Mwadui, Tanzania.',
    cat: 'finance',
    juris: ['TZ', 'BW', 'ZA'],
    t: {
      sw: 'almasi',
      fr: 'diamant',
      de: 'Diamant',
    },
  },
];

export const MINING_ENTRIES: readonly GlossaryEntry[] = Object.freeze(
  buildEntries(CORE_SPECS),
);
