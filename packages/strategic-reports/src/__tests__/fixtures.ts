/**
 * Shared test fixtures + fakes for the strategic-reports test suite.
 *
 * - Fake brain that echoes the user prompt back as section bodies in
 *   the structured format the parser expects. Deterministic.
 * - Fake document studio that produces a deterministic byte buffer
 *   from the report title + format.
 * - Fake audit store that captures appends and returns synthetic
 *   entry ids so the tests can assert on what was written.
 * - Fake report store (in-memory map).
 * - Helper to build a ReportSpec for any report type.
 * - Fixture advisor ports that satisfy every gatherer.
 */

import type {
  AuditEntry,
  AuditPort,
  BrainPort,
  BrainSynthesizeArgs,
  BrainSynthesizeResult,
  CitationVerifierPort,
  Citation,
  DocumentStudioPort,
  PersistedReport,
  RenderRequest,
  RenderedReportArtifact,
  ReportFormat,
  ReportSpec,
  ReportStore,
  ReportStoreListFilters,
  ReportType,
} from '../types.js';
import type {
  AcquisitionAdvisorPort,
  AdvisorPorts,
  ConditionalSurveyPort,
  ExpansionAdvisorPort,
  GreenAngleAdvisorPort,
  LeasingFinancialPort,
  LifecycleAdvisorPort,
  RentRollPort,
  SustainabilityAdvisorPort,
  TenantContextPort,
} from '../gatherers/ports.js';

// ────────────────────────────────────────────────────────────────────────────
// Fake brain — emits one '### section-id:<id>' block per blueprint section.
// ────────────────────────────────────────────────────────────────────────────

export interface FakeBrainOptions {
  readonly synthesizerId?: string;
  readonly agreement?: number;
  readonly escalate?: boolean;
  readonly proposerIds?: ReadonlyArray<string>;
  readonly throwOnInvocation?: boolean;
}

export interface FakeBrain extends BrainPort {
  readonly calls: ReadonlyArray<BrainSynthesizeArgs>;
}

export function createFakeBrain(opts: FakeBrainOptions = {}): FakeBrain {
  const calls: BrainSynthesizeArgs[] = [];
  const self: FakeBrain = {
    get calls() {
      return calls;
    },
    async synthesize(args: BrainSynthesizeArgs): Promise<BrainSynthesizeResult> {
      calls.push(args);
      if (opts.throwOnInvocation) {
        throw new Error('Fake brain configured to throw.');
      }
      // The user prompt has a `# Required sections` block followed by
      // `## <title> (id=<id>)` headings. We re-emit each as a structured
      // section the parser recognises.
      const sectionIds = extractSectionIds(args.userPrompt);
      const body = sectionIds
        .map(
          (id) =>
            `### section-id:${id}\n#### ${id} narrative\nThe narrative for ${id} grounds in the citation key emitted by the gatherer. Verdict: actionable.`,
        )
        .join('\n\n');
      return {
        content: body || '### section-id:unknown\nfallback narrative\nVerdict: actionable.',
        agreement: opts.agreement ?? 0.92,
        escalate: opts.escalate ?? false,
        proposerIds: opts.proposerIds ?? ['fake-proposer-a', 'fake-proposer-b'],
        synthesizerId: opts.synthesizerId ?? 'fake-synthesizer-merge',
        mode: 'merge',
      };
    },
  };
  return self;
}

function extractSectionIds(prompt: string): ReadonlyArray<string> {
  const re = /\(id=([\w-]+)\)/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) ids.push(m[1]!);
  return ids;
}

// ────────────────────────────────────────────────────────────────────────────
// Fake document studio.
// ────────────────────────────────────────────────────────────────────────────

export interface FakeDocumentStudio extends DocumentStudioPort {
  readonly renders: ReadonlyArray<RenderRequest>;
}

export function createFakeDocumentStudio(): FakeDocumentStudio {
  const renders: RenderRequest[] = [];
  return {
    get renders() {
      return renders;
    },
    async render(req: RenderRequest): Promise<RenderedReportArtifact> {
      renders.push(req);
      const payload = `${req.report.title}::${req.format}::${req.templateRef ?? 'none'}`;
      const buffer = new TextEncoder().encode(payload);
      return {
        format: req.format,
        mimeType: mimeFor(req.format),
        buffer,
        sha256: `sha256:${payload.length.toString(16).padStart(8, '0')}`,
      };
    },
  };
}

function mimeFor(format: ReportFormat): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'html':
      return 'text/html';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fake WORM audit port.
// ────────────────────────────────────────────────────────────────────────────

export interface FakeAuditPort extends AuditPort {
  readonly entries: ReadonlyArray<AuditEntry>;
}

export function createFakeAudit(): FakeAuditPort {
  const entries: AuditEntry[] = [];
  return {
    get entries() {
      return entries;
    },
    async append(entry): Promise<AuditEntry> {
      const full: AuditEntry = {
        ...entry,
        entryId: `audit_${entries.length + 1}`,
        chainHash: `chain_${entries.length + 1}`,
        createdAtIso: new Date('2026-05-24T00:00:00Z').toISOString(),
      };
      entries.push(full);
      return full;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fake report store.
// ────────────────────────────────────────────────────────────────────────────

export function createFakeStore(): ReportStore & { readonly all: ReadonlyArray<PersistedReport> } {
  const items = new Map<string, PersistedReport>();
  return {
    get all() {
      return Array.from(items.values());
    },
    async save(record: PersistedReport): Promise<PersistedReport> {
      items.set(record.reportId, record);
      return record;
    },
    async get(reportId: string): Promise<PersistedReport | null> {
      return items.get(reportId) ?? null;
    },
    async list(filters: ReportStoreListFilters): Promise<ReadonlyArray<PersistedReport>> {
      const out = Array.from(items.values()).filter((r) => r.orgId === filters.orgId);
      const filtered = filters.type ? out.filter((r) => r.type === filters.type) : out;
      const limit = filters.limit ?? filtered.length;
      return filtered.slice(0, limit);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fake citation verifier.
// ────────────────────────────────────────────────────────────────────────────

export function createFakeCitationVerifier(opts: { force?: 'ok' | 'fail' } = {}): CitationVerifierPort {
  return {
    verify(args: { text: string; citations: ReadonlyArray<Citation> }) {
      if (opts.force === 'fail') {
        return {
          ok: false,
          missing: [{ fragment: 'numeric claim found without citation', reason: 'numeric-uncited' }],
        };
      }
      // Default — always ok, returning the citation count as cited claims.
      return { ok: true, citedClaims: args.citations.length };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture advisor ports — return deterministic shapes for every gatherer.
// ────────────────────────────────────────────────────────────────────────────

const TZS = (value: number): { currency: string; value: number } => ({ currency: 'TZS', value });

export const fixtureLeasingFinancial: LeasingFinancialPort = {
  async fetchRevenueTrend() {
    return [
      { periodLabel: 'Apr 2026', billed: TZS(10_000), collected: TZS(9_400), arrears: TZS(600) },
      { periodLabel: 'May 2026', billed: TZS(10_500), collected: TZS(9_800), arrears: TZS(700) },
      { periodLabel: 'Jun 2026', billed: TZS(11_000), collected: TZS(10_350), arrears: TZS(650) },
    ];
  },
  async fetchOccupancyTrend() {
    return [
      { periodLabel: 'Apr 2026', leasedUnits: 18, totalUnits: 20 },
      { periodLabel: 'May 2026', leasedUnits: 19, totalUnits: 20 },
      { periodLabel: 'Jun 2026', leasedUnits: 19, totalUnits: 20 },
    ];
  },
};

export const fixtureConditionalSurvey: ConditionalSurveyPort = {
  async fetchLatestSurvey() {
    return {
      propertyId: 'prop-fixture',
      surveyDateIso: '2026-04-15T10:00:00Z',
      surveyorId: 'surveyor-fixture',
      overallGrade: 'B',
      defects: [
        { defectId: 'd-1', element: 'roof', severity: 'major', costEstimate: TZS(2_500), notedAtIso: '2026-04-15T10:00:00Z' },
        { defectId: 'd-2', element: 'HVAC', severity: 'moderate', costEstimate: TZS(1_200), notedAtIso: '2026-04-15T10:00:00Z' },
        { defectId: 'd-3', element: 'envelope', severity: 'critical', costEstimate: TZS(4_000), notedAtIso: '2026-04-15T10:00:00Z' },
      ],
    };
  },
  async fetchPriorSurvey() {
    return {
      propertyId: 'prop-fixture',
      surveyDateIso: '2025-04-15T10:00:00Z',
      surveyorId: 'surveyor-fixture',
      overallGrade: 'B',
      defects: [
        { defectId: 'd-old-1', element: 'roof', severity: 'moderate', costEstimate: TZS(1_500), notedAtIso: '2025-04-15T10:00:00Z' },
      ],
    };
  },
};

export const fixtureAcquisition: AcquisitionAdvisorPort = {
  async fetchDeal() {
    return {
      dealId: 'deal-fixture',
      propertyId: 'prop-fixture',
      askPrice: TZS(500_000),
      modelledValue: TZS(475_000),
      noi: TZS(40_000),
      impliedCapRate: 0.0842,
      compTriangulationRange: { low: TZS(460_000), high: TZS(490_000) },
      dealKillers: [
        { id: 'dk-env', title: 'Environmental REC under appendix B', severity: 'medium' },
        { id: 'dk-title', title: 'Schedule B-II unresolved item', severity: 'low' },
      ],
      recommendation: 'pursue',
    };
  },
};

export const fixtureLifecycle: LifecycleAdvisorPort = {
  async fetchDispositionThesis() {
    return {
      propertyId: 'prop-fixture',
      recommendedExit: 'list-next-quarter',
      impliedExitValue: TZS(520_000),
      buyerPool: [
        { buyerType: 'core-institutional', weight: 0.55 },
        { buyerType: 'high-net-worth', weight: 0.30 },
        { buyerType: 'value-add', weight: 0.15 },
      ],
      sensitivities: [
        { factor: 'cap-rate-25bp', delta: 0.0025, impactPct: -3.4 },
        { factor: 'noi-3pct-uplift', delta: 0.03, impactPct: 2.9 },
      ],
    };
  },
  async fetchRefinancingProposal() {
    return {
      propertyId: 'prop-fixture',
      currentLoan: { principal: TZS(300_000), ratePct: 8.25, maturityIso: '2027-06-30' },
      proposed: { principal: TZS(310_000), ratePct: 7.40, term_yrs: 10, ltvPct: 62.5, dscr: 1.35 },
      lenderShortlist: [
        { name: 'Lender A', fitScore: 0.88 },
        { name: 'Lender B', fitScore: 0.79 },
      ],
      stressTests: [
        { scenario: '+200bp parallel', dscrUnderStress: 1.12, covenantOk: true },
        { scenario: '-15% NOI', dscrUnderStress: 1.05, covenantOk: false },
      ],
    };
  },
};

export const fixtureSustainability: SustainabilityAdvisorPort = {
  async fetchSnapshot() {
    return {
      propertyId: 'prop-fixture',
      periodLabel: 'FY26',
      scope1KgCO2e: 1500,
      scope2KgCO2e: 4500,
      scope3KgCO2e: 2300,
      intensityKgCO2ePerM2: 22.5,
      crremDeltaPct: -3.2,
      euTaxonomyAligned: true,
      bngNetGainPct: 12,
      nbsOpportunities: [
        { id: 'nbs-1', title: 'Green roof retrofit', priority: 'high' },
        { id: 'nbs-2', title: 'Permeable forecourt', priority: 'medium' },
      ],
    };
  },
};

export const fixtureExpansion: ExpansionAdvisorPort = {
  async fetchExpansionRecommendation() {
    return {
      orgId: 'org-fixture',
      markets: [
        { market: 'Dar es Salaam', riskAdjYoCPct: 8.4, absorption_mo: 9, verdict: 'enter' },
        { market: 'Mwanza', riskAdjYoCPct: 7.1, absorption_mo: 14, verdict: 'monitor' },
      ],
      capitalStack: { debtPct: 60, prefEquityPct: 20, commonEquityPct: 20 },
      preferredHbu: 'Mixed-use mid-density residential',
    };
  },
};

export const fixtureGreenAngle: GreenAngleAdvisorPort = {
  async fetchGreenAngleSummary() {
    return {
      orgId: 'org-fixture',
      topAngles: [
        { id: 'ga-1', title: 'Solar canopy on garage', impactScore: 0.71, capexEstimate: TZS(18_000) },
        { id: 'ga-2', title: 'Cool-roof coating', impactScore: 0.42, capexEstimate: TZS(4_500) },
      ],
    };
  },
};

export const fixtureTenantContext: TenantContextPort = {
  async fetchTenantProfile() {
    return {
      tenantPersonId: 'person-fixture',
      displayName: 'Asha Mwakapina',
      lifecycleStage: 'paying',
      paymentHistory: [
        { periodLabel: 'Apr 2026', onTimePct: 98, arrearsDays: 0 },
        { periodLabel: 'May 2026', onTimePct: 91, arrearsDays: 5 },
        { periodLabel: 'Jun 2026', onTimePct: 100, arrearsDays: 0 },
      ],
      complaints: [
        { id: 'c-1', summary: 'Leaky tap in unit 4B', resolvedAtIso: '2026-04-10T00:00:00Z' },
      ],
      creditSignals: [
        { signal: 'on-time-streak', weight: 0.72 },
        { signal: 'income-stability', weight: 0.81 },
      ],
    };
  },
};

export const fixtureRentRoll: RentRollPort = {
  async fetchRentRoll() {
    return [
      { unitId: 'u-1', tenantName: 'Asha M.', monthlyRent: TZS(800), leaseStartIso: '2025-01-01', leaseEndIso: '2026-12-31', arrears: TZS(0), arrearsAgeingDays: 0 },
      { unitId: 'u-2', tenantName: 'Brian K.', monthlyRent: TZS(750), leaseStartIso: '2025-04-01', leaseEndIso: '2026-09-30', arrears: TZS(900), arrearsAgeingDays: 45 },
      { unitId: 'u-3', tenantName: 'Carol N.', monthlyRent: TZS(820), leaseStartIso: '2024-11-01', leaseEndIso: '2026-10-31', arrears: TZS(1_640), arrearsAgeingDays: 95 },
      { unitId: 'u-4', tenantName: 'Daudi T.', monthlyRent: TZS(700), leaseStartIso: '2025-06-01', leaseEndIso: '2027-05-31', arrears: TZS(0), arrearsAgeingDays: 0 },
    ];
  },
};

export const fixtureAdvisorPorts: AdvisorPorts = Object.freeze({
  leasingFinancial: fixtureLeasingFinancial,
  conditionalSurvey: fixtureConditionalSurvey,
  acquisition: fixtureAcquisition,
  lifecycle: fixtureLifecycle,
  sustainability: fixtureSustainability,
  expansion: fixtureExpansion,
  greenAngle: fixtureGreenAngle,
  tenantContext: fixtureTenantContext,
  rentRoll: fixtureRentRoll,
});

// ────────────────────────────────────────────────────────────────────────────
// ReportSpec builder — adapts the scope to the report type.
// ────────────────────────────────────────────────────────────────────────────

export function buildSpec(type: ReportType, overrides?: Partial<ReportSpec>): ReportSpec {
  const base: ReportSpec = {
    type,
    scope: scopeFor(type),
    audience: 'board',
    depth: 'standard',
    format: 'html',
    jurisdiction: 'TZ',
    period: {
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
      label: 'FY26 Q2',
    },
    prompt: `Generate the ${type} report for the test fixture.`,
    actorId: 'test-actor',
  };
  return { ...base, ...overrides };
}

function scopeFor(type: ReportType): ReportSpec['scope'] {
  switch (type) {
    case 'tenant_credit_risk_profile':
      return { kind: 'tenant', tenantPersonId: 'person-fixture', orgId: 'org-fixture' };
    case 'acquisition_deal_ic_memo':
      return { kind: 'deal', dealId: 'deal-fixture', orgId: 'org-fixture', propertyId: 'prop-fixture' };
    case 'leasing_financial_performance':
    case 'annual_estate_operating_review':
    case 'rent_roll_arrears_ledger':
    case 'expansion_strategy_memo':
      return { kind: 'portfolio', orgId: 'org-fixture' };
    case 'conditional_survey_of_assets':
    case 'disposition_memo_asset_profile':
    case 'refinancing_strategy_memo':
    case 'sustainability_ghg_report':
      return { kind: 'property', propertyId: 'prop-fixture', orgId: 'org-fixture' };
  }
}
