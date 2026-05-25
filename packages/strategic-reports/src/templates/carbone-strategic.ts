/**
 * Carbone template binder for strategic reports (DOCX).
 *
 * Carbone consumes a docx template + a JSON context. This module
 * shapes the `StrategicReport` into the context JSON Carbone expects
 * and returns the template reference id the document-studio renderer
 * uses to look up the bundled .docx skeleton.
 *
 * Production wiring: the .docx skeleton ships under
 * `packages/document-studio/templates/strategic-report/` and is
 * authored by hand in Word. This module is the contract the renderer
 * receives — the template id is stable, the JSON shape is stable.
 */

import type { StrategicReport } from '../types.js';

export interface CarboneContext {
  readonly meta: {
    readonly title: string;
    readonly subtitle: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly audience: string;
    readonly depth: string;
    readonly jurisdiction: string;
    readonly generatedAtIso: string;
  };
  readonly executiveSummary: string;
  readonly sections: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly evidenceUnavailable: boolean;
    readonly tables: ReadonlyArray<{
      readonly title: string;
      readonly headers: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<ReadonlyArray<string>>;
    }>;
  }>;
  readonly actionPlan: ReadonlyArray<{
    readonly id: string;
    readonly priority: string;
    readonly title: string;
    readonly description: string;
    readonly owner: string;
    readonly dueDateIso: string;
    readonly successCriterion: string;
  }>;
  readonly citations: ReadonlyArray<{
    readonly id: string;
    readonly claim: string;
    readonly source: string;
  }>;
}

export interface CarboneBinding {
  /** Template id the renderer looks up in the templates registry. */
  readonly templateId: string;
  readonly context: CarboneContext;
}

export function buildCarboneBinding(report: StrategicReport): CarboneBinding {
  return {
    templateId: `strategic-report/${report.type}.docx`,
    context: {
      meta: {
        title: report.title,
        subtitle: `${report.spec.audience} · ${report.spec.depth} · ${report.spec.jurisdiction}`,
        periodStart: report.spec.period.periodStart,
        periodEnd: report.spec.period.periodEnd,
        audience: report.spec.audience,
        depth: report.spec.depth,
        jurisdiction: report.spec.jurisdiction,
        generatedAtIso: new Date().toISOString(),
      },
      executiveSummary: report.executiveSummary,
      sections: report.sections.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        evidenceUnavailable: s.evidenceUnavailable === true,
        tables: s.tables.map((t) => ({
          title: t.title,
          headers: t.headers,
          rows: t.rows.map((r) => r.map((c) => String(c))),
        })),
      })),
      actionPlan: report.actionPlan.map((a) => ({
        id: a.id,
        priority: a.priority,
        title: a.title,
        description: a.description,
        owner: a.owner,
        dueDateIso: a.dueDateIso,
        successCriterion: a.successCriterion,
      })),
      citations: report.citations.map((c) => ({
        id: c.id,
        claim: c.claim,
        source: `${c.source.kind}/${c.source.ref}`,
      })),
    },
  };
}
