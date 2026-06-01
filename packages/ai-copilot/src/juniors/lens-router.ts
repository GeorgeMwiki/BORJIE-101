/**
 * Lens router — the Master Brain's INTERNAL persona palette.
 *
 * There are no user-selectable "modes" in Borjie. Mr. Mwikila reads the
 * owner's message and, on its own, decides which persona lens(es) to think
 * through — often several at once. A narrow question ("summarise last
 * night's shift") engages one lens; a cross-domain question ("should I sell
 * the graphite given FX and the licence renewal?") engages Finance +
 * Compliance + Strategy together, blended into one answer.
 *
 * These eight lenses are the former owner-facing CEO modes, PROMOTED from a
 * row of buttons into the brain's internal palette. Each lens carries:
 *   - a `directive` (system steering text injected into the Master Brain
 *     prompt so the answer actually reasons through that persona),
 *   - `juniorAffinities` (which juniors this lens tends to pull on),
 *   - a `derivedMode` (the brain's own internal MasterBrainMode the lens
 *     maps onto, so the existing mode-gated hard-rules keep firing).
 *
 * Classification is deterministic (signal-scored, no LLM): it is the
 * offline-safe, testable steering layer. The Master Brain's Sonnet pass
 * still performs the final junior selection — now informed by the blended
 * lens directive instead of a mode the owner had to pick.
 *
 * Counterpart: `personas/mining-ceo-modes.ts` (`MINING_CEO_MODES`) is the
 * SAME eight-lens concept for the central-intelligence kernel path — it
 * carries the heavyweight per-mode `system_prompt` + `tools_allowed`
 * envelope. This module is the lighter classifier/blender for the juniors
 * dispatch path (`mining/chat`). Keep the lens set in the two in sync.
 */

import { type MasterBrainMode } from './master-brain.js';

export type LensId =
  | 'build'
  | 'strategy'
  | 'operations'
  | 'document'
  | 'finance'
  | 'risk'
  | 'board'
  | 'compliance';

export interface Lens {
  readonly id: LensId;
  /** Human label — also surfaced (read-only) in the blended directive. */
  readonly label: string;
  /** System steering text injected into the Master Brain prompt. */
  readonly directive: string;
  /** Juniors this lens tends to engage (real `JuniorName`s). */
  readonly juniorAffinities: ReadonlyArray<string>;
  /** Internal brain mode this lens maps onto (keeps mode-gated rules alive). */
  readonly derivedMode: MasterBrainMode;
  /** Case-insensitive signals; a hit scores the lens. No `g` flag (stateful). */
  readonly signals: ReadonlyArray<RegExp>;
}

/**
 * The eight lenses, ordered so that signal-score ties resolve deterministically
 * by registry index (lower index wins). `board` precedes `compliance` so an
 * investor pack outranks an incidental obligation mention.
 */
export const LENS_REGISTRY: ReadonlyArray<Lens> = [
  {
    id: 'strategy',
    label: 'Strategy',
    directive:
      'Think as the CEO allocating capital across the portfolio — rank sites, weigh trade-offs, and frame the decision and its second-order effects.',
    juniorAffinities: ['forecast-modeler', 'risk-modeler', 'cost-engineer', 'mine-planner'],
    derivedMode: 'planning',
    signals: [
      /\bshould i\b/i,
      /\bstrateg/i,
      /\ballocat/i,
      /\bcapital\b/i,
      /\bportfolio\b/i,
      /\brank\b/i,
      /\bexpand/i,
      /\binvest(?!or)/i,
      /\bprioriti/i,
      /\btrade-?off/i,
      /\bdecision\b/i,
    ],
  },
  {
    id: 'build',
    label: 'Build',
    directive:
      'Stand up the company — structure sites, people, licences and core documents during onboarding.',
    juniorAffinities: ['licence-agent', 'document-agent', 'hr-agent', 'operations-sic-agent'],
    derivedMode: 'planning',
    signals: [
      /\bonboard/i,
      /\bset ?up\b/i,
      /\borg chart\b/i,
      /\bstructure\b/i,
      /\bimport\b/i,
      /\bcreate a site\b/i,
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    directive:
      'Think through cash, FX exposure, burn rate, runway and unit economics — quantify the money impact and the break-even.',
    juniorAffinities: [
      'cost-engineer',
      'fx-treasury-agent',
      'sales-offtake-agent',
      'contract-currency-auditor',
    ],
    derivedMode: 'sales',
    signals: [
      /\bfx\b/i,
      /\bcurrenc/i,
      /\busd\b/i,
      /\btzs\b/i,
      /\bcash\b/i,
      /\brunway\b/i,
      /\bburn\b/i,
      /\bcost\b/i,
      /\bprice\b/i,
      /\bsell\b/i,
      /\bsale\b/i,
      /\brevenue\b/i,
      /\btreasur/i,
      /\binvoice/i,
      /\bmargin/i,
      /\bbreak-?even/i,
      /\bforecast/i,
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    directive:
      'Read the live operating picture — shifts, production vs target, blockers and downtime — and surface what needs the owner now.',
    juniorAffinities: [
      'operations-sic-agent',
      'hr-agent',
      'asset-fleet-agent',
      'maintenance-agent',
    ],
    derivedMode: 'ask',
    signals: [
      /\bshift/i,
      /\bproduction\b/i,
      /\btarget\b/i,
      /\bblocker/i,
      /\bdowntime\b/i,
      /\boutput\b/i,
      /\bthroughput\b/i,
      /\bnight shift\b/i,
    ],
  },
  {
    id: 'risk',
    label: 'Risk',
    directive:
      'Scan cross-domain for risk — licence dormancy, safety, community sentiment, vendor decay — and rank by likelihood and impact.',
    juniorAffinities: [
      'risk-modeler',
      'compliance-agent',
      'safety-agent',
      'community-agent',
      'contract-currency-auditor',
    ],
    derivedMode: 'ask',
    signals: [
      /\brisk/i,
      /\bsafety\b/i,
      /\bhazard/i,
      /\bincident/i,
      /\bgrievance/i,
      /\bsentiment\b/i,
      /\bvendor\b/i,
      /\bdorman/i,
      /\bthreat/i,
    ],
  },
  {
    id: 'board',
    label: 'Board / Investor',
    directive:
      'Speak in a clean external narrative — investor-pack tone, longer context, provenance baked in.',
    juniorAffinities: ['report-writer', 'forecast-modeler', 'cost-engineer'],
    derivedMode: 'ask',
    signals: [
      /\bboard\b/i,
      /\binvestor/i,
      /\bpack\b/i,
      /\bnarrative\b/i,
      /\bone-?pager\b/i,
      /\bbank\b/i,
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    directive:
      'Anchor to the regulator citation library — obligations by jurisdiction, action checklists, and filing deadlines.',
    juniorAffinities: ['compliance-agent', 'licence-agent', 'contract-currency-auditor'],
    derivedMode: 'compliance',
    signals: [
      /\blicen[cs]e/i,
      /\brenewal\b/i,
      /\bregulat/i,
      /\bcomplian/i,
      /\bobligation/i,
      /\btmaa\b/i,
      /\btra\b/i,
      /\bpermit\b/i,
      /\baudit\b/i,
      /\bfiling\b/i,
      /\bmining act\b/i,
    ],
  },
  {
    id: 'document',
    label: 'Document',
    directive:
      'Prepare or interpret documents — renewal packs, standard letters, diffs — with full evidence provenance.',
    juniorAffinities: ['document-agent', 'licence-agent', 'compliance-agent', 'report-writer'],
    derivedMode: 'ask',
    signals: [
      /\bdocument\b/i,
      /\bdraft\b/i,
      /\bletter\b/i,
      /\brenewal pack\b/i,
      /\brefile\b/i,
      /\bdiff\b/i,
    ],
  },
];

/** Fallback lens when the message matches no signals (broad CEO lens). */
export const DEFAULT_LENS_ID: LensId = 'strategy';

export interface LensSelection {
  /** Selected lens ids, primary first, ordered by descending signal strength. */
  readonly lenses: ReadonlyArray<LensId>;
  /** The highest-scoring lens (drives the derived brain mode). */
  readonly primary: LensId;
  /** The internal MasterBrainMode derived from the primary lens. */
  readonly derivedMode: MasterBrainMode;
  /** Blended system directive naming every selected lens — fed to the brain. */
  readonly directive: string;
  /** Short machine-readable explanation of why these lenses were chosen. */
  readonly rationale: string;
}

export interface ClassifyLensesOptions {
  /** Cap on how many lenses to blend at once (default 3). */
  readonly maxLenses?: number;
}

const byId = (id: LensId): Lens => {
  const lens = LENS_REGISTRY.find((l) => l.id === id);
  if (!lens) throw new Error(`Unknown lens: ${id}`);
  return lens;
};

function scoreLens(lens: Lens, text: string): number {
  return lens.signals.reduce((sum, re) => sum + (re.test(text) ? 1 : 0), 0);
}

/**
 * Build the blended directive injected into the Master Brain prompt. Names
 * each selected lens (read-only — the owner never picked these) so the model
 * reasons through every persona at once and composes a single answer.
 */
function blendDirective(lenses: ReadonlyArray<Lens>): string {
  const names = lenses.map((l) => l.label).join(', ');
  const bullets = lenses.map((l) => `- ${l.label}: ${l.directive}`).join('\n');
  if (lenses.length === 1) {
    return `Think through the ${names} lens:\n${bullets}`;
  }
  return [
    `Think through these blended lenses at once: ${names}.`,
    bullets,
    'Compose ONE answer that satisfies every selected lens — do not present them as separate sections unless the owner asks.',
  ].join('\n');
}

/**
 * Classify an owner message into 1..N internal lenses. Deterministic: scores
 * each lens by signal hits, keeps the top `maxLenses` with a non-zero score,
 * and falls back to the default lens when nothing matches. Always returns at
 * least one lens; the first is the primary.
 */
export function classifyLenses(
  message: string,
  opts?: ClassifyLensesOptions,
): LensSelection {
  const maxLenses = Math.max(1, opts?.maxLenses ?? 3);
  const text = message.toLowerCase();

  const ranked = LENS_REGISTRY.map((lens, index) => ({
    lens,
    index,
    score: scoreLens(lens, text),
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected =
    ranked.length === 0
      ? [byId(DEFAULT_LENS_ID)]
      : ranked.slice(0, maxLenses).map((r) => r.lens);

  const primary = selected[0]!;
  const rationale =
    ranked.length === 0
      ? `no_signal_match:default_to_${DEFAULT_LENS_ID}`
      : selected
          .map((l) => {
            const r = ranked.find((x) => x.lens.id === l.id)!;
            return `${l.id}(${r.score})`;
          })
          .join('+');

  return {
    lenses: selected.map((l) => l.id),
    primary: primary.id,
    derivedMode: primary.derivedMode,
    directive: blendDirective(selected),
    rationale,
  };
}
