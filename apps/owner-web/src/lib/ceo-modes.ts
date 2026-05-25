/**
 * Master Brain CEO modes — owner-facing persona switcher.
 *
 * Mirrors BOJI_AI_SPEC §4.2 (Master Brain modes) and the founder
 * directive that surfaces 8 distinct CEO-style operating modes on
 * the conversational surface (O-W-02). Each mode binds the chat
 * persona to a specific tool surface, default temperature, and a
 * curated set of sample prompts the owner can launch immediately.
 *
 * The runtime contract (system prompt, tool whitelist, temperature)
 * is owned by the brain kernel — this catalogue only describes the
 * surface (label, blurb, sample prompts) so the UI stays a pure
 * projection of the spec.
 */

export type CeoModeId =
  | 'build'
  | 'strategy'
  | 'operations'
  | 'document'
  | 'finance'
  | 'risk'
  | 'board'
  | 'compliance';

export interface CeoMode {
  readonly id: CeoModeId;
  readonly label: string;
  readonly labelSw: string;
  readonly blurb: string;
  readonly toolsSummary: string;
  readonly samplePrompts: ReadonlyArray<string>;
}

export const CEO_MODES: ReadonlyArray<CeoMode> = [
  {
    id: 'build',
    label: 'Build',
    labelSw: 'Jenga',
    blurb:
      'Stand up the company. Structure sites, people, licences, and core documents during onboarding.',
    toolsSummary: 'Company, Licence, People, Document agents',
    samplePrompts: [
      'Onboard Mawe Bora and import the four PML scans in /uploads.',
      'Create a site under Geita and link it to PML 25434.',
      'Set up an org chart with 1 mine manager, 2 supervisors, 18 operators.',
    ],
  },
  {
    id: 'strategy',
    label: 'Strategy',
    labelSw: 'Mkakati',
    blurb:
      'Portfolio ranking, capital allocation, and mechanisation decisions across all sites.',
    toolsSummary: 'All read tools + simulator + forecaster',
    samplePrompts: [
      'Rank my 3 sites by expected free cash flow over 18 months.',
      'Should I buy a second excavator or upgrade the wash plant first?',
      'Model the Mbeya coltan site at $33/lb vs $41/lb tantalum.',
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    labelSw: 'Uendeshaji',
    blurb:
      'Daily plan, shift information, blockers and the live operating picture.',
    toolsSummary: 'Shift, SIC, HR, Asset, Inventory agents',
    samplePrompts: [
      'Summarise last 24 hours across all sites.',
      'Why was night shift at Nyakabale 38% below target?',
      'Open blockers waiting on me to decide.',
    ],
  },
  {
    id: 'document',
    label: 'Document',
    labelSw: 'Hati',
    blurb:
      'File, refile, prepare renewal packs and standard letters with full bbox evidence.',
    toolsSummary: 'Document, Licence, Compliance agents',
    samplePrompts: [
      'Prepare the PML 25434 renewal pack — what is missing?',
      'Draft a road-use letter to Kakola village council.',
      'Diff the 2024 vs 2025 EPP report — what changed?',
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    labelSw: 'Fedha',
    blurb:
      'Burn rate, cash, FX exposure, runway and unit-economics decisions.',
    toolsSummary: 'Cost, Treasury, Sales agents',
    samplePrompts: [
      'What is my 90-day runway if gold drops to $2,180/oz?',
      'How much TZS will the 27-Mar cliff cost me on existing USD invoices?',
      'Break-even unit cost at Nyakabale right now.',
    ],
  },
  {
    id: 'risk',
    label: 'Risk',
    labelSw: 'Hatari',
    blurb:
      'Cross-domain scan: licence dormancy, safety, community sentiment, FX, vendor decay.',
    toolsSummary: 'Every audit tool',
    samplePrompts: [
      'Top 5 risks across the portfolio right now, with confidence.',
      'Which licences are within 60 days of a renewal or fee gate?',
      'Any community grievances trending up in the last 30 days?',
    ],
  },
  {
    id: 'board',
    label: 'Board / Investor',
    labelSw: 'Bodi / Wawekezaji',
    blurb:
      'Clean external narrative — investor-pack tone, longer context, provenance baked in.',
    toolsSummary: 'Report Writer + read tools',
    samplePrompts: [
      'Draft Q2 board pack — production, finance, risk, asks.',
      'Prepare a one-pager for NMB Bank on the Mbeya facility request.',
      'Investor FAQ: how are we protected against the TZS-only cliff?',
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    labelSw: 'Uzingatiaji',
    blurb:
      'Regulator citation library, action checklists, and obligation tracking by jurisdiction.',
    toolsSummary: 'Compliance + Auditor / Evidence agents',
    samplePrompts: [
      'List every Mining Act 2010 obligation I am within 30 days of.',
      'Generate the audit pack for the upcoming TMAA inspection.',
      'Map this month\'s LSM submissions against the regulator checklist.',
    ],
  },
];

export function getCeoMode(id: CeoModeId): CeoMode {
  const found = CEO_MODES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown CEO mode: ${id}`);
  return found;
}
