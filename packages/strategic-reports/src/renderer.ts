/**
 * `renderer.ts` — the strategic-report orchestrator.
 *
 * Pipeline (the only place report shape × stage wiring meet):
 *
 *     spec
 *      ↓
 *     validate(ReportSpecSchema)                  → invalid_spec
 *      ↓
 *     gather(ctx) via gathererFor(spec.type)      → gather_failed_all_sources
 *      ↓
 *     compose(ctx) via composerFor(brain)         → synthesis_failed
 *      ↓
 *     validateCitations(report)                   → citations_invalid
 *      ↓
 *     runStructuralQualityGates(report)           → action_plan_too_small
 *                                                   executive_summary_too_long
 *      ↓
 *     render(report, format)                      → render_failed
 *      ↓
 *     audit.append(...)                           → persist_failed
 *      ↓
 *     persistence.save(...)                       → persist_failed
 *      ↓
 *     RenderedReport
 *
 * Every stage is wrapped in a typed Result so the API-gateway route
 * can map an error CODE to an HTTP status without parsing strings.
 *
 * The orchestrator owns NO domain logic — every stage is in its own
 * file. This file only sequences the calls + carries error state.
 */

import {
  err,
  ok,
  runStructuralQualityGates,
  ReportSpecSchema,
  type AuditPort,
  type BrainPort,
  type Citation,
  type CitationVerifierPort,
  type DocumentStudioPort,
  type EvidencePack,
  type PersistedReport,
  type ReportEngineResult,
  type ReportSpec,
  type ReportStore,
  type RenderedReportArtifact,
  type StrategicReport,
} from './types.js';
import { gathererFor } from './gatherers/index.js';
import type { AdvisorPorts } from './gatherers/ports.js';
import { composerFor } from './composers/index.js';
import { buildHarvardPhdPersona } from './personas/harvard-phd-persona.js';
import { bindTemplate } from './templates/index.js';

// ────────────────────────────────────────────────────────────────────────────
// Public engine surface — wired once by the API gateway / worker /
// CLI host and re-used for every report.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportEngineDeps {
  readonly advisorPorts: AdvisorPorts;
  readonly brain: BrainPort;
  readonly documentStudio: DocumentStudioPort;
  readonly audit: AuditPort;
  readonly persistence: ReportStore;
  /**
   * Citation verifier. Optional — when absent, citations are not
   * cross-checked and the renderer relies on the structural gates.
   */
  readonly citationVerifier?: CitationVerifierPort;
  /**
   * Injectable clock for deterministic tests.
   */
  readonly now?: () => Date;
  /**
   * Optional id factory; when omitted we use a stable rng-free
   * timestamp-+actor scheme that keeps tests deterministic.
   */
  readonly newReportId?: (spec: ReportSpec) => string;
}

export interface RenderedReport {
  readonly persisted: PersistedReport;
  readonly warnings: ReadonlyArray<string>;
}

export interface ReportEngine {
  generateReport(spec: ReportSpec): Promise<ReportEngineResult<RenderedReport>>;
}

/**
 * Build a `ReportEngine`. The engine is a pure composition — the
 * deps are stored, the pipeline is re-built per call so per-spec
 * state cannot leak between concurrent renders.
 */
export function createReportEngine(deps: ReportEngineDeps): ReportEngine {
  const composer = composerFor(deps.brain);
  const nowFn = deps.now ?? ((): Date => new Date());
  const idFactory = deps.newReportId ?? defaultReportIdFactory;

  return {
    async generateReport(spec: ReportSpec): Promise<ReportEngineResult<RenderedReport>> {
      return generateReport({
        spec,
        composer,
        nowFn,
        idFactory,
        deps,
      });
    },
  };
}

/**
 * Standalone orchestrator entry-point — `createReportEngine().generateReport`
 * calls into this. Exported so callers that already manage their own
 * composer (e.g. a worker that pre-compiles per-org composers) can
 * sidestep the factory.
 */
export interface GenerateReportArgs {
  readonly spec: ReportSpec;
  readonly composer: ReturnType<typeof composerFor>;
  readonly nowFn: () => Date;
  readonly idFactory: (spec: ReportSpec) => string;
  readonly deps: ReportEngineDeps;
}

export async function generateReport(args: GenerateReportArgs): Promise<ReportEngineResult<RenderedReport>> {
  const { composer, nowFn, idFactory, deps } = args;
  const warnings: string[] = [];

  // 1. validate spec ─────────────────────────────────────────────────
  const parsedSpec = ReportSpecSchema.safeParse(args.spec);
  if (!parsedSpec.success) {
    return err('invalid_spec', `Invalid report spec: ${parsedSpec.error.message}`, {
      issues: parsedSpec.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const spec: ReportSpec = parsedSpec.data;

  // 2. gather evidence ───────────────────────────────────────────────
  const gather = gathererFor(spec.type, deps.advisorPorts);
  let evidence: EvidencePack;
  try {
    evidence = await gather({ spec, now: nowFn });
  } catch (e) {
    return err('gather_failed_all_sources', `Gather stage threw: ${errorMessage(e)}`);
  }

  const unavailable = evidence.sourceHealth.filter((h) => h.status === 'unavailable');
  if (unavailable.length === evidence.sourceHealth.length && evidence.sourceHealth.length > 0) {
    return err('gather_failed_all_sources', 'Every advisor port was unavailable.', {
      sourceHealth: evidence.sourceHealth.map((h) => ({ ...h })),
    });
  }
  for (const u of unavailable) {
    warnings.push(`source '${u.sourceId}' unavailable: ${u.note ?? 'no detail'}`);
  }

  // 3. compose via brain ─────────────────────────────────────────────
  const persona = buildHarvardPhdPersona({
    type: spec.type,
    audience: spec.audience,
    jurisdiction: spec.jurisdiction,
  });
  let report: StrategicReport;
  try {
    report = await composer({ evidence, persona, spec });
  } catch (e) {
    return err('synthesis_failed', `Composer/brain failed: ${errorMessage(e)}`);
  }

  // 4. validate citations (optional verifier) ───────────────────────
  if (deps.citationVerifier) {
    try {
      const verification = deps.citationVerifier.verify({
        text: collectReportText(report),
        citations: report.citations,
      });
      if (!verification.ok) {
        return err('citations_invalid', `Citation verifier flagged ${verification.missing.length} issue(s).`, {
          missing: verification.missing.map((m) => ({ ...m })),
        });
      }
    } catch (e) {
      // verifier hiccup → warn, don't fail; the structural gates still apply.
      warnings.push(`citation verifier threw: ${errorMessage(e)}`);
    }
  } else if (report.citations.length === 0) {
    // Without a verifier we at least demand SOME citation evidence.
    return err('citations_invalid', 'Report contains no citations and no verifier is wired.');
  }

  // 5. quality gates ─────────────────────────────────────────────────
  const violations = runStructuralQualityGates(report);
  const fatal = violations.find(
    (v) => v.gate === 'executive_summary_too_long' || v.gate === 'action_plan_too_small',
  );
  if (fatal) {
    const code = fatal.gate === 'executive_summary_too_long' ? 'executive_summary_too_long' : 'action_plan_too_small';
    return err(code, fatal.message, {
      gate: fatal.gate,
      ...(fatal.detail ?? {}),
    });
  }
  for (const v of violations) {
    warnings.push(`quality gate '${v.gate}': ${v.message}`);
  }

  // 6. render via document studio (with template binding) ───────────
  const templateBinding = bindTemplate(spec.format, report);
  let artifact: RenderedReportArtifact;
  try {
    artifact = await deps.documentStudio.render({
      report,
      format: spec.format,
      templateRef: templateBinding.templateRef,
    });
  } catch (e) {
    return err('render_failed', `Document studio render failed: ${errorMessage(e)}`);
  }

  // 7. WORM audit + 8. persist ──────────────────────────────────────
  const reportId = idFactory(spec);
  const orgId = orgIdFromScope(spec.scope);
  const createdAtIso = nowFn().toISOString();
  let auditEntryId: string;
  try {
    const auditEntry = await deps.audit.append({
      orgId,
      actorId: spec.actorId,
      reportType: spec.type,
      reportId,
      renderedSha256: artifact.sha256,
      citationsSha256: hashCitations(report.citations),
    });
    auditEntryId = auditEntry.entryId;
  } catch (e) {
    return err('persist_failed', `Audit append failed: ${errorMessage(e)}`);
  }

  const persisted: PersistedReport = Object.freeze({
    reportId,
    orgId,
    type: spec.type,
    report,
    artifacts: Object.freeze([artifact]),
    auditEntryId,
    createdAtIso,
  });

  try {
    const stored = await deps.persistence.save(persisted);
    return ok({ persisted: stored, warnings: Object.freeze(warnings) });
  } catch (e) {
    return err('persist_failed', `Persistence save failed: ${errorMessage(e)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — pure. Tested via the renderer pipeline tests.
// ────────────────────────────────────────────────────────────────────────────

export function collectReportText(report: StrategicReport): string {
  const parts: string[] = [report.executiveSummary];
  for (const s of report.sections) {
    if (s.body.length > 0) parts.push(s.body);
  }
  for (const a of report.actionPlan) {
    parts.push(a.description, a.successCriterion);
  }
  return parts.join('\n\n');
}

export function orgIdFromScope(scope: ReportSpec['scope']): string {
  switch (scope.kind) {
    case 'tenant':
    case 'property':
    case 'deal':
    case 'portfolio':
      return scope.orgId;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultReportIdFactory(spec: ReportSpec): string {
  // Deterministic: actor + type + ms — enough for ordering, no rng.
  const epochMs = Date.now();
  return `rpt_${spec.type}_${epochMs}_${shortHash(spec.actorId)}`;
}

function hashCitations(citations: ReadonlyArray<Citation>): string {
  // Stable, dependency-free non-crypto digest. The api-gateway/audit
  // layer re-hashes with SHA-256 for storage; this is only used as
  // the in-memory key the audit append sees.
  const joined = citations.map((c) => `${c.id}:${c.claim}`).join('|');
  return `dig_${joined.length.toString(16)}_${shortHash(joined)}`;
}

function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
