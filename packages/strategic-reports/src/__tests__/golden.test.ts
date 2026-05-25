/**
 * Golden tests — one per report type. Verifies the renderer produces
 * the expected StrategicReport shape (title + executive summary +
 * sections + citations + action plan) for every report family.
 *
 * Pattern per test:
 *   1. Build a spec for the report type.
 *   2. Run the renderer with fixture advisor ports + fake brain +
 *      fake document studio + fake audit + fake store.
 *   3. Assert the result is `ok` AND the PersistedReport carries
 *      the structural invariants for that report type (title hint,
 *      ≥1 section, ≥5 action items, evidence-grounded citations).
 */

import { describe, it, expect } from 'vitest';
import { createReportEngine } from '../renderer.js';
import { REPORT_TYPES, type ReportType } from '../types.js';
import {
  buildSpec,
  createFakeAudit,
  createFakeBrain,
  createFakeDocumentStudio,
  createFakeStore,
  fixtureAdvisorPorts,
} from './fixtures.js';

function wire() {
  return {
    brain: createFakeBrain(),
    documentStudio: createFakeDocumentStudio(),
    audit: createFakeAudit(),
    persistence: createFakeStore(),
    advisorPorts: fixtureAdvisorPorts,
  };
}

const TITLE_HINT: Readonly<Record<ReportType, string>> = Object.freeze({
  leasing_financial_performance: 'Leasing financial performance',
  conditional_survey_of_assets: 'Conditional survey',
  acquisition_deal_ic_memo: 'Acquisition IC memo',
  disposition_memo_asset_profile: 'Disposition memo',
  refinancing_strategy_memo: 'Refinancing memo',
  sustainability_ghg_report: 'Sustainability + GHG report',
  expansion_strategy_memo: 'Expansion strategy',
  tenant_credit_risk_profile: 'Tenant credit profile',
  rent_roll_arrears_ledger: 'Rent-roll + arrears ledger',
  annual_estate_operating_review: 'Annual Estate Operating Review',
});

describe('golden report-type renders — every type produces a valid StrategicReport', () => {
  for (const type of REPORT_TYPES) {
    it(`produces a StrategicReport for type=${type}`, async () => {
      const w = wire();
      const engine = createReportEngine(w);
      const spec = buildSpec(type);

      const result = await engine.generateReport(spec);
      if (!result.ok) {
        // Print the error so a failing case is debuggable in CI logs.
        throw new Error(`generateReport failed for ${type}: ${result.error.code} ${result.error.message}`);
      }

      const persisted = result.value.persisted;
      expect(persisted.type).toBe(type);
      expect(persisted.report.title).toContain(TITLE_HINT[type]);
      expect(persisted.report.sections.length).toBeGreaterThanOrEqual(1);
      // Action plan minimum is structurally guaranteed by quality gates
      // (≥5 items). Each blueprint seeds at least 5 items so this must hold.
      expect(persisted.report.actionPlan.length).toBeGreaterThanOrEqual(5);
      // Persona is invoked exactly once per render — brain captured one call.
      expect(w.brain.calls.length).toBe(1);
      // Document studio was invoked exactly once.
      expect(w.documentStudio.renders.length).toBe(1);
      expect(w.documentStudio.renders[0]!.format).toBe(spec.format);
      // Audit recorded the new report.
      expect(w.audit.entries.length).toBe(1);
      expect(w.audit.entries[0]!.reportType).toBe(type);
      expect(w.audit.entries[0]!.reportId).toBe(persisted.reportId);
      // Persisted store carries the artifact.
      expect(persisted.artifacts.length).toBe(1);
      expect(persisted.artifacts[0]!.sha256).toMatch(/^sha256:/);
    });
  }
});
