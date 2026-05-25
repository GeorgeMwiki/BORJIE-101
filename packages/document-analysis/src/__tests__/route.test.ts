import { describe, expect, it } from 'vitest';
import { decideRouting, ROUTING_MATRIX } from '../route/index.js';
import type { ExtractedField } from '../extract/entity-extractor.js';

function field(key: string, confidence = 0.95): ExtractedField {
  return {
    key,
    value: 'whatever',
    confidence,
    extractionKind: 'entity',
    sourceMethod: 'rule',
    page: 1,
    bbox: null,
  };
}

describe('decideRouting matrix coverage', () => {
  it('covers every doc type', () => {
    expect(Object.keys(ROUTING_MATRIX)).toEqual(
      expect.arrayContaining([
        'lease_application',
        'lease_contract',
        'payment_receipt',
        'national_id',
        'condition_survey',
        'complaint_letter',
        'renewal_request',
        'termination_notice',
        'vendor_invoice',
      ]),
    );
  });
});

describe('decideRouting — happy paths', () => {
  it('lease_application → estate.create_lease_application (auto-apply at high confidence)', () => {
    const decisions = decideRouting({
      docType: 'lease_application',
      docTypeConfidence: 0.9,
      extractions: [
        field('applicant_name'),
        field('requested_asset'),
        field('requested_rent'),
      ],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.targetModule).toBe('estate');
    expect(decisions[0]?.targetAction).toBe('create_lease_application');
    expect(decisions[0]?.hitlRequired).toBe(false);
  });

  it('payment_receipt → finance.post_receipt', () => {
    const decisions = decideRouting({
      docType: 'payment_receipt',
      docTypeConfidence: 0.9,
      extractions: [field('amount'), field('gepg_reference')],
    });
    expect(decisions[0]?.targetModule).toBe('finance');
    expect(decisions[0]?.targetAction).toBe('post_receipt');
  });

  it('national_id → compliance.archive_id', () => {
    const decisions = decideRouting({
      docType: 'national_id',
      docTypeConfidence: 0.9,
      extractions: [field('id_number'), field('full_name')],
    });
    expect(decisions[0]?.targetModule).toBe('compliance');
    expect(decisions[0]?.targetAction).toBe('archive_id');
  });

  it('condition_survey → estate.update_condition', () => {
    const decisions = decideRouting({
      docType: 'condition_survey',
      docTypeConfidence: 0.9,
      extractions: [field('asset_reference'), field('inspection_date')],
    });
    expect(decisions[0]?.targetModule).toBe('estate');
    expect(decisions[0]?.targetAction).toBe('update_condition');
  });

  it('complaint_letter → crm.open_ticket', () => {
    const decisions = decideRouting({
      docType: 'complaint_letter',
      docTypeConfidence: 0.9,
      extractions: [field('complainant_name'), field('asset_reference')],
    });
    expect(decisions[0]?.targetModule).toBe('crm');
    expect(decisions[0]?.targetAction).toBe('open_ticket');
  });
});

describe('decideRouting — HITL flags', () => {
  it('flags HITL when a required field is missing', () => {
    const decisions = decideRouting({
      docType: 'lease_contract',
      docTypeConfidence: 0.9,
      extractions: [field('tenant_name'), field('asset_reference')],
      // missing monthly_rent
    });
    expect(decisions[0]?.hitlRequired).toBe(true);
    expect(decisions[0]?.reasoning?.['requiredKeysMissing']).toContain(
      'monthly_rent',
    );
  });

  it('flags HITL when overall confidence is below the auto-apply threshold', () => {
    const decisions = decideRouting({
      docType: 'lease_application',
      docTypeConfidence: 0.6,
      extractions: [
        field('applicant_name', 0.6),
        field('requested_asset', 0.6),
      ],
    });
    expect(decisions[0]?.hitlRequired).toBe(true);
  });

  it('routes unknown → crm.open_ticket with HITL', () => {
    const decisions = decideRouting({
      docType: 'unknown',
      docTypeConfidence: 0.1,
      extractions: [],
    });
    expect(decisions[0]?.targetModule).toBe('crm');
    expect(decisions[0]?.hitlRequired).toBe(true);
  });
});
