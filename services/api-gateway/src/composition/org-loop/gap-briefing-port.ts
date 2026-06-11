/**
 * gap-briefing-port.ts — the SELF-RUNNING-ORG spine OWNER-BRIEFING stage.
 *
 * THE STAGE THIS IS
 * -----------------
 * Before the spine actually assigns the corrective work, the owner gets a
 * colleague-note: "here's the gap, here's who I'd put on it, approve?". This
 * port maps an `org_loop_run` projection (competence domain + gap kind + the
 * STRATEGIZE trace + the chosen employee + the matcher's confidence) into an
 * `EstateProposal` so it rides the EXISTING gated proposal sink
 * (`createTabEventLogProposalSink` → `proactive_nudge` → owner cockpit inbox).
 * It never invents a new surface and never bypasses the gate.
 *
 * MINTO PYRAMID (Principle 2)
 * ---------------------------
 * The brief leads with the CONCLUSION, then the EVIDENCE, then the RECOMMENDED
 * ACTION, then WHAT-I-NEED:
 *   conclusion : "Licence renewal is overdue — it blocks new permits."
 *   evidence   : "(82% fit — cert match, low load)"  ← the matcher's reasoning
 *   action     : "I plan to assign it to Asha."
 *   need       : "Approve?"
 *
 * SINGLE-LANGUAGE PER LOCALE (CLAUDE.md, ABSOLUTE)
 * -----------------------------------------------
 * `brief(run, locale)` renders the title + rationale ENTIRELY in the active
 * locale — EN and SW are built from disjoint phrase tables, never interleaved.
 * Zero EN tokens leak into an `sw` brief and vice-versa.
 *
 * DEDUPE BY CONSTRUCTION
 * ----------------------
 * The proposal id is `drive:<driveId>` (or `gap:<commitmentId>` for a driveless
 * gap), so a brief COALESCES with the EstateMind slow-loop nudge for the same
 * concern instead of double-spamming the owner inbox.
 *
 * PURE: no IO. Immutable outputs (frozen). No `console.*`.
 */

// The EstateProposal shape is owned by the kernel; we reuse it verbatim so the
// brief rides the same gated sink the EstateMind slow loop writes.
import type { estateMind as estateMindNs } from '@borjie/central-intelligence';

type EstateProposal = estateMindNs.EstateProposal;
type DriveId = EstateProposal['driveId'];

import type {
  CompetenceDomain,
  StrategyUrgency,
  TaskPriority,
} from './strategize-port.js';

export type BriefLocale = 'en' | 'sw';

// ─────────────────────────────────────────────────────────────────────
// The run projection the brief reads. The spine lane's `org_loop_run` row
// projects onto this structural view — we depend only on the fields the
// owner brief needs, nothing wider.
// ─────────────────────────────────────────────────────────────────────

/** The STRATEGIZE trace fields the brief surfaces (`strategy_json` subset). */
export interface StrategyJsonView {
  readonly title: string;
  readonly competenceDomain: CompetenceDomain;
  readonly priority: TaskPriority;
  readonly urgency: StrategyUrgency;
  readonly rationale: string;
}

/** The matched assignee the brief names (the matcher's choice + reasoning). */
export interface ChosenEmployeeView {
  readonly employeeId: string;
  /** Owner-facing display name (e.g. "Asha"). Falls back to the id. */
  readonly displayName?: string | null;
  /** Confidence in [0,1] — rendered as a whole-number percent. */
  readonly matchConfidence: number;
  /**
   * Short matcher reasons, PER LOCALE so the brief stays single-language by
   * construction (CLAUDE.md ABSOLUTE no-mixing rule). `{ en: ['cert match',
   * 'low load'], sw: ['cheti kinafanana', 'mzigo mdogo'] }`. A locale with no
   * reasons (or the whole field absent) simply omits the reason clause — never
   * falls back to the OTHER locale's tokens.
   */
  readonly matchReasons?: Partial<Record<BriefLocale, ReadonlyArray<string>>>;
}

/** The `org_loop_run` projection the brief consumes. */
export interface OrgLoopRunView {
  readonly tenantId: string;
  /** The originating commitment/gap id (dedupe + provenance). */
  readonly commitmentId: string;
  /** Standing-drive id when the gap maps to one (drives the dedupe key). */
  readonly driveId?: string | null;
  /** The typed gap kind, when this run closes a capability gap. */
  readonly gapKind?: string | null;
  readonly competenceDomain: CompetenceDomain;
  readonly strategy: StrategyJsonView;
  readonly chosenEmployee: ChosenEmployeeView;
  /** Evidence ids threaded from the gap (Auditor evidence-required rail). */
  readonly evidenceIds: ReadonlyArray<string>;
  /** Wall-clock the run reached the briefing stage. */
  readonly proposedAtMs: number;
}

export interface GapBriefingPort {
  /** Map a run projection → a single-language `EstateProposal`. PURE. */
  brief(run: OrgLoopRunView, locale?: BriefLocale): EstateProposal;
}

// ─────────────────────────────────────────────────────────────────────
// Phrase tables — DISJOINT per locale. Each builds the pyramid copy from
// the SAME structured facts; no string is ever mixed across locales.
// ─────────────────────────────────────────────────────────────────────

/** Human-readable competence-domain label per locale (single-language). */
const DOMAIN_LABELS: Record<BriefLocale, Record<CompetenceDomain, string>> = {
  en: {
    production: 'production',
    maintenance: 'maintenance',
    workforce: 'workforce',
    compliance: 'compliance',
    treasury: 'treasury',
    procurement: 'procurement',
    safety: 'safety',
    geology: 'geology',
    logistics: 'logistics',
  },
  sw: {
    production: 'uzalishaji',
    maintenance: 'matengenezo',
    workforce: 'wafanyakazi',
    compliance: 'uzingatiaji',
    treasury: 'hazina',
    procurement: 'ununuzi',
    safety: 'usalama',
    geology: 'jiolojia',
    logistics: 'usafirishaji',
  },
};

/** Urgency-band label per locale. */
const URGENCY_LABELS: Record<BriefLocale, Record<StrategyUrgency, string>> = {
  en: { low: 'low', medium: 'medium', high: 'high', critical: 'critical' },
  sw: { low: 'chini', medium: 'wastani', high: 'juu', critical: 'dharura' },
};

function pct(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

function assigneeName(run: OrgLoopRunView): string {
  const name = run.chosenEmployee.displayName?.trim();
  return name && name.length > 0 ? name : run.chosenEmployee.employeeId;
}

/** The matcher reasons for ONE locale only — never the other locale's tokens. */
function localeReasons(run: OrgLoopRunView, locale: BriefLocale): ReadonlyArray<string> {
  const reasons = run.chosenEmployee.matchReasons?.[locale] ?? [];
  return reasons.filter((r) => r.trim().length > 0);
}

/** Build the EN pyramid brief — conclusion → evidence → action → need. */
function briefEn(run: OrgLoopRunView): { title: string; rationale: string } {
  const domain = DOMAIN_LABELS.en[run.competenceDomain];
  const urgency = URGENCY_LABELS.en[run.strategy.urgency];
  const name = assigneeName(run);
  const confidence = pct(run.chosenEmployee.matchConfidence);
  const reasons = localeReasons(run, 'en');
  const reasonClause = reasons.length > 0 ? ` — ${reasons.join(', ')}` : '';
  // Conclusion (the gap), already authored in EN by the strategy title.
  const conclusion = `${run.strategy.title} (${domain}, ${urgency} priority).`;
  // Evidence (the matcher reasoning) + recommended action.
  const action = `I plan to assign it to ${name} (${confidence}% fit${reasonClause}).`;
  // What I need.
  const need = 'Approve?';
  return {
    title: run.strategy.title,
    rationale: `${conclusion} ${action} ${need}`,
  };
}

/** Build the SW pyramid brief — disjoint phrase table, zero EN tokens. */
function briefSw(run: OrgLoopRunView): { title: string; rationale: string } {
  const domain = DOMAIN_LABELS.sw[run.competenceDomain];
  const urgency = URGENCY_LABELS.sw[run.strategy.urgency];
  const name = assigneeName(run);
  const confidence = pct(run.chosenEmployee.matchConfidence);
  const reasons = localeReasons(run, 'sw');
  const reasonClause = reasons.length > 0 ? ` — ${reasons.join(', ')}` : '';
  const conclusion = `${run.strategy.title} (${domain}, kipaumbele ${urgency}).`;
  const action = `Napanga kumkabidhi ${name} (ulinganifu ${confidence}%${reasonClause}).`;
  const need = 'Idhinisha?';
  return {
    title: run.strategy.title,
    rationale: `${conclusion} ${action} ${need}`,
  };
}

/**
 * Build the dedupe-stable proposal id. `drive:<driveId>` when the gap maps to a
 * standing drive (coalesces with the EstateMind nudge); else `gap:<commitmentId>`
 * so a driveless gap still has a stable, idempotent key.
 */
export function briefProposalId(run: OrgLoopRunView): string {
  const drive = run.driveId?.trim();
  return drive && drive.length > 0 ? `drive:${drive}` : `gap:${run.commitmentId}`;
}

/**
 * Create the OWNER-BRIEFING port. Stateless + pure — every `brief` is a pure
 * mapping with no IO. The default locale is `en` (CLAUDE.md default language).
 */
export function createGapBriefingPort(): GapBriefingPort {
  return {
    brief(run, locale = 'en') {
      const copy = locale === 'sw' ? briefSw(run) : briefEn(run);
      // The proposal's driveId carries the standing-drive when present; a
      // driveless gap reuses the competence domain as the drive coordinate so
      // the proposal still type-checks against the open-by-data driveId union
      // (mirrors loop-economy-wiring's documented cast).
      const driveIdRaw =
        run.driveId && run.driveId.trim().length > 0
          ? run.driveId.trim()
          : run.competenceDomain;
      return Object.freeze({
        tenantId: run.tenantId,
        id: briefProposalId(run),
        driveId: driveIdRaw as DriveId,
        title: copy.title,
        rationale: copy.rationale,
        locale,
        urgency: run.strategy.urgency,
        breachSeverity: 0,
        evidenceEntityIds: Object.freeze([...run.evidenceIds]),
        proposedAtMs: run.proposedAtMs,
      });
    },
  };
}
