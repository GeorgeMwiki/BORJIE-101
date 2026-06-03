/**
 * Regulator-sim tests: audit replay invariants, supervision pack
 * determinism, and PDPA access/erasure drills.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_REASON_CODES,
  SUPERVISION_PACK_REQUIRED_SECTIONS,
  buildSupervisionPack,
  createInMemoryPdpaSurface,
  fulfilErasure,
  fulfilSubjectAccess,
  pdpaEndToEnd,
  replayAudit,
  summarizeAudit,
  type AuditReplayInput,
  type DecisionRecord,
  type SubjectArtefact,
} from '../index.js';

const NOW = '2026-06-03T12:00:00.000Z';

function goodRecord(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: 'dec-1',
    domain: 'royalty',
    decidedAt: '2026-06-02T09:00:00.000Z',
    outcome: 'approve',
    cotTrace: 'cot-hash-abc',
    reasonCodes: ['ROYALTY_RECONCILED'],
    reasonNotesEn: 'Royalty reconciled against assay.',
    reasonNotesSw: 'Mrabaha umelinganishwa na uchunguzi wa madini.',
    modelId: 'mwikila-royalty-v3',
    modelCardVersion: '3.1',
    modelCardCurrentAt: '2026-05-20T00:00:00.000Z',
    fairnessTpDelta: 0.02,
    fairnessFpDelta: 0.01,
    crossOrgAction: false,
    approverIds: ['officer-a'],
    ...over,
  };
}

const baseInput = (records: ReadonlyArray<DecisionRecord>): AuditReplayInput => ({
  fromIso: '2026-06-01T00:00:00.000Z',
  toIso: '2026-06-03T00:00:00.000Z',
  records,
  fairnessTolerance: 0.1,
  registeredModelIds: ['mwikila-royalty-v3'],
  allowedReasonCodes: [...DEFAULT_ALLOWED_REASON_CODES],
  modelCardMaxAgeDays: 90,
});

describe('replayAudit — clean pass', () => {
  it('passes a fully compliant in-window record', () => {
    const res = replayAudit(baseInput([goodRecord()]), NOW);
    expect(res.passed).toBe(true);
    expect(res.recordsReplayed).toBe(1);
    expect(res.findings).toHaveLength(0);
    expect(summarizeAudit(res)).toMatch(/PASS/);
  });

  it('ignores records outside the date window', () => {
    const out = goodRecord({
      decisionId: 'dec-old',
      decidedAt: '2025-01-01T00:00:00.000Z',
    });
    const res = replayAudit(baseInput([out]), NOW);
    expect(res.recordsReplayed).toBe(0);
    expect(res.passed).toBe(true);
  });
});

describe('replayAudit — findings', () => {
  it('flags a missing chain-of-thought trace as critical', () => {
    const res = replayAudit(baseInput([goodRecord({ cotTrace: '  ' })]), NOW);
    expect(res.passed).toBe(false);
    expect(res.findings[0]?.code).toBe('missing_cot');
    expect(res.findings[0]?.severity).toBe('critical');
  });

  it('flags missing Swahili notes (bilingual requirement)', () => {
    const res = replayAudit(baseInput([goodRecord({ reasonNotesSw: '' })]), NOW);
    expect(res.findings.some((f) => f.code === 'missing_bilingual_notes')).toBe(true);
  });

  it('flags an unregistered model', () => {
    const res = replayAudit(baseInput([goodRecord({ modelId: 'rogue-model' })]), NOW);
    expect(res.findings.some((f) => f.code === 'unknown_model')).toBe(true);
  });

  it('flags a stale model card', () => {
    const res = replayAudit(
      baseInput([goodRecord({ modelCardCurrentAt: '2026-01-01T00:00:00.000Z' })]),
      NOW,
    );
    expect(res.findings.some((f) => f.code === 'stale_model_card')).toBe(true);
  });

  it('flags a disallowed reason code', () => {
    const res = replayAudit(
      baseInput([goodRecord({ reasonCodes: ['MADE_UP_CODE'] })]),
      NOW,
    );
    expect(res.findings.some((f) => f.code === 'disallowed_reason_code')).toBe(true);
  });

  it('flags a cross-org action without two distinct approvers', () => {
    const res = replayAudit(
      baseInput([
        goodRecord({ crossOrgAction: true, approverIds: ['officer-a', 'officer-a'] }),
      ]),
      NOW,
    );
    expect(res.findings.some((f) => f.code === 'missing_four_eye')).toBe(true);
  });

  it('passes a cross-org action with two distinct approvers', () => {
    const res = replayAudit(
      baseInput([
        goodRecord({ crossOrgAction: true, approverIds: ['officer-a', 'officer-b'] }),
      ]),
      NOW,
    );
    expect(res.passed).toBe(true);
  });

  it('flags a fairness breach beyond tolerance', () => {
    const res = replayAudit(baseInput([goodRecord({ fairnessTpDelta: 0.25 })]), NOW);
    expect(res.findings.some((f) => f.code === 'fairness_breach')).toBe(true);
  });

  it('accumulates multiple findings in one pass without throwing', () => {
    const res = replayAudit(
      baseInput([
        goodRecord({
          cotTrace: '',
          reasonNotesSw: '',
          modelId: 'rogue',
          fairnessFpDelta: 0.9,
        }),
      ]),
      NOW,
    );
    expect(res.findings.length).toBeGreaterThanOrEqual(4);
    expect(summarizeAudit(res)).toMatch(/FAIL/);
  });
});

describe('buildSupervisionPack', () => {
  const input = {
    periodFromIso: '2026-04-01',
    periodToIso: '2026-06-30',
    institution: 'Borjie Estate Holdings Ltd',
    miningLicenceNumber: 'ML-2026-0042',
    royaltyRemittanceRatio: 1.0,
    licenceComplianceRatio: 0.97,
    liquidityRatio: 1.2,
    amlAlerts: 4,
    amlClosed: 4,
  };

  it('produces all eight required sections', () => {
    const pack = buildSupervisionPack(input);
    const titles = pack.documents.map((d) => d.title);
    for (const required of SUPERVISION_PACK_REQUIRED_SECTIONS) {
      expect(titles).toContain(required);
    }
  });

  it('is deterministic for a given input', () => {
    expect(buildSupervisionPack(input).checksum).toBe(
      buildSupervisionPack(input).checksum,
    );
  });

  it('reports a royalty shortfall when remittance < 100%', () => {
    const pack = buildSupervisionPack({ ...input, royaltyRemittanceRatio: 0.8 });
    const royalty = pack.documents.find((d) => d.title === 'Royalty Remittance');
    expect(royalty?.contents).toMatch(/SHORTFALL/);
  });

  it('reports a treasury liquidity breach below the minimum', () => {
    const pack = buildSupervisionPack({ ...input, liquidityRatio: 0.5 });
    const liq = pack.documents.find((d) => d.title === 'Treasury Liquidity');
    expect(liq?.contents).toMatch(/BREACH/);
  });
});

describe('PDPA readiness drills', () => {
  const artefacts: ReadonlyArray<SubjectArtefact> = [
    {
      subjectId: 'owner-1',
      kind: 'licence_application',
      id: 'a1',
      contents: 'Applicant owner-1, partner Asha Komba listed.',
      thirdPartyPiiFields: ['Asha Komba'],
    },
    {
      subjectId: 'owner-1',
      kind: 'decision',
      id: 'a2',
      contents: 'Royalty approved.',
      legalHoldUntilIso: '2027-01-01T00:00:00.000Z',
    },
    { subjectId: 'other', kind: 'document', id: 'a3', contents: 'unrelated' },
  ];

  it('fulfils subject access and redacts third-party PII', () => {
    const surface = createInMemoryPdpaSurface(artefacts);
    const res = fulfilSubjectAccess(
      { subjectId: 'owner-1', receivedAt: NOW, scope: 'full' },
      surface,
      NOW,
    );
    expect(res.passed).toBe(true);
    expect(res.artefactsCount).toBe(2);
    expect(res.redactedFields).toContain('Asha Komba');
  });

  it('flags a subject with no artefacts', () => {
    const surface = createInMemoryPdpaSurface(artefacts);
    const res = fulfilSubjectAccess(
      { subjectId: 'ghost', receivedAt: NOW, scope: 'full' },
      surface,
      NOW,
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toMatch(/no artefacts/);
  });

  it('honours legal hold on erasure', () => {
    const surface = createInMemoryPdpaSurface(artefacts);
    const res = fulfilErasure({ subjectId: 'owner-1', receivedAt: NOW }, surface, NOW);
    expect(res.passed).toBe(true);
    expect(res.artefactsCount).toBe(1); // a1 erased
    expect(res.residualOnLegalHold).toContain('a2'); // held until 2027
    expect(surface.snapshot().some((a) => a.id === 'a1')).toBe(false);
    expect(surface.snapshot().some((a) => a.id === 'a2')).toBe(true);
  });

  it('runs the end-to-end access+erasure drill', () => {
    const surface = createInMemoryPdpaSurface(artefacts);
    const { access, erasure } = pdpaEndToEnd('owner-1', surface, NOW);
    expect(access.passed).toBe(true);
    expect(erasure.passed).toBe(true);
  });
});
