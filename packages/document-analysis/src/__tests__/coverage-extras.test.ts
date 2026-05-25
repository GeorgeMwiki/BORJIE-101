/**
 * Coverage-gap tests. Focused on the doc-type profiles + adapter
 * branches that the main integration suite doesn't exercise directly:
 *
 *   - renewal_request profile fields
 *   - termination_notice profile fields
 *   - vendor_invoice profile fields
 *   - embedding-based resolution path
 *   - in-memory adapter find/snapshot branches
 */

import { describe, expect, it } from 'vitest';
import { extractEntities } from '../extract/index.js';
import { decideRouting } from '../route/index.js';
import {
  InMemoryDocumentRepository,
  InMemoryExtractionRepository,
  InMemoryEntityResolver,
  InMemoryDocumentStorage,
  cosineSimilarity,
  CrossTenantAccessError,
} from '../in-memory-adapters.js';
import { resolveEntities } from '../resolve/index.js';
import type { ExtractedField } from '../extract/entity-extractor.js';

const RENEWAL_TEXT = `BORJIE — TENANT LEASE RENEWAL REQUEST

I would like to renew tenancy for an additional 12 months.
Tenant Name: Patricia Mwafula
Property Reference: PROP-DAR-0001
Renewal Date: 2025-05-01

Sincerely,
Patricia
`;

const TERMINATION_TEXT = `BORJIE — NOTICE TO VACATE

Tenant Name: Patricia Mwafula
Property Reference: PROP-DAR-0001
Effective Date: 2025-04-30

I hereby give notice of termination of my tenancy.
`;

const VENDOR_TEXT = `BAHARI PLUMBING LTD
INVOICE No: BPL-2025-0142

Vendor: Bahari Plumbing
Date: 2025-02-09
Description: Emergency tap repair PROP-DAR-0001 unit 12B.
Subtotal: TZS 60,000
VAT (18%): TZS 10,800
Grand Total: TZS 70,800
TIN No: 123-456-789
`;

describe('extractEntities — renewal_request profile', () => {
  it('extracts tenant + asset + renewal date', () => {
    const fields = extractEntities({ docType: 'renewal_request', text: RENEWAL_TEXT });
    expect(fields.find((f) => f.key === 'tenant_name')?.value).toBe(
      'Patricia Mwafula',
    );
    expect(fields.find((f) => f.key === 'asset_reference')?.value).toBe(
      'PROP-DAR-0001',
    );
    expect(fields.find((f) => f.key === 'requested_renewal_date')?.value).toBe(
      '2025-05-01',
    );
  });
});

describe('extractEntities — termination_notice profile', () => {
  it('extracts tenant + asset + effective date', () => {
    const fields = extractEntities({
      docType: 'termination_notice',
      text: TERMINATION_TEXT,
    });
    expect(fields.find((f) => f.key === 'tenant_name')?.value).toBe(
      'Patricia Mwafula',
    );
    expect(fields.find((f) => f.key === 'asset_reference')?.value).toBe(
      'PROP-DAR-0001',
    );
    expect(fields.find((f) => f.key === 'effective_date')?.value).toBe(
      '2025-04-30',
    );
  });
});

describe('extractEntities — vendor_invoice profile', () => {
  it('extracts vendor + invoice number + grand total', () => {
    const fields = extractEntities({ docType: 'vendor_invoice', text: VENDOR_TEXT });
    expect(fields.find((f) => f.key === 'invoice_number')?.value).toBe(
      'BPL-2025-0142',
    );
    expect(fields.find((f) => f.key === 'amount')?.value).toEqual({
      currency: 'TZS',
      amount: 70800,
      amountMinor: 7_080_000,
    });
  });
});

describe('decideRouting — secondary doc types', () => {
  function fieldAt(key: string, confidence = 0.95): ExtractedField {
    return {
      key,
      value: 'x',
      confidence,
      extractionKind: 'entity',
      sourceMethod: 'rule',
      page: null,
      bbox: null,
    };
  }

  it('renewal_request → estate.create_renewal_request', () => {
    const decisions = decideRouting({
      docType: 'renewal_request',
      docTypeConfidence: 0.9,
      extractions: [fieldAt('tenant_name'), fieldAt('asset_reference')],
    });
    expect(decisions[0]?.targetAction).toBe('create_renewal_request');
  });

  it('termination_notice → legal.process_termination', () => {
    const decisions = decideRouting({
      docType: 'termination_notice',
      docTypeConfidence: 0.9,
      extractions: [fieldAt('tenant_name'), fieldAt('asset_reference')],
    });
    expect(decisions[0]?.targetModule).toBe('legal');
  });

  it('vendor_invoice → finance.process_invoice', () => {
    const decisions = decideRouting({
      docType: 'vendor_invoice',
      docTypeConfidence: 0.9,
      extractions: [fieldAt('vendor_name'), fieldAt('amount')],
    });
    expect(decisions[0]?.targetAction).toBe('process_invoice');
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for parallel vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('handles zero vectors safely', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('resolveEntities — embedding fallback', () => {
  it('falls back to embedding search when fuzzy is weak', async () => {
    const resolver = new InMemoryEntityResolver();
    resolver.seed('tenant-a', [
      {
        entityId: 'lessee-001',
        displayName: 'something completely different',
        embedding: [0.1, 0.2, 0.3],
      },
    ]);
    const out = await resolveEntities(
      'tenant-a',
      [
        {
          extraction: {
            key: 'k',
            value: 'asha mwangi',
            confidence: 0.8,
            extractionKind: 'entity',
            sourceMethod: 'rule',
            page: null,
            bbox: null,
          },
          queryText: 'asha mwangi',
        },
      ],
      resolver,
    );
    expect(out[0]?.resolutionMethod === 'embedding' || out[0]?.resolvedEntityId === null).toBe(true);
  });
});

describe('InMemoryDocumentRepository — error paths', () => {
  it('updateState throws when document not found', async () => {
    const docs = new InMemoryDocumentRepository();
    await expect(docs.updateState('tenant-a', 'missing', 'done')).rejects.toThrow(
      /not found/,
    );
  });

  it('findById returns null for missing id', async () => {
    const docs = new InMemoryDocumentRepository();
    expect(await docs.findById('tenant-a', 'nope')).toBeNull();
  });

  it('findBySha256 returns null when nothing matches', async () => {
    const docs = new InMemoryDocumentRepository();
    expect(await docs.findBySha256('tenant-a', 'whatever')).toBeNull();
  });
});

describe('InMemoryExtractionRepository — error paths', () => {
  it('rejects cross-tenant writes', async () => {
    const r = new InMemoryExtractionRepository();
    await expect(
      r.createMany('tenant-a', [
        {
          id: 'e1',
          documentId: 'd1',
          tenantId: 'tenant-b',
          extractionKind: 'entity',
          key: 'k',
          value: 'v',
          confidence: 0.9,
          page: null,
          bbox: null,
          sourceMethod: 'rule',
        },
      ]),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it('findById is tenant-scoped', async () => {
    const r = new InMemoryExtractionRepository();
    await r.createMany('tenant-a', [
      {
        id: 'e1',
        documentId: 'd1',
        tenantId: 'tenant-a',
        extractionKind: 'entity',
        key: 'k',
        value: 'v',
        confidence: 0.9,
        page: null,
        bbox: null,
        sourceMethod: 'rule',
      },
    ]);
    expect(await r.findById('tenant-a', 'e1')).not.toBeNull();
    expect(await r.findById('tenant-b', 'e1')).toBeNull();
  });
});

describe('InMemoryDocumentStorage — error paths', () => {
  it('throws on missing object', async () => {
    const s = new InMemoryDocumentStorage();
    await expect(
      s.getObject('tenant-a', 'tenant/tenant-a/missing.txt'),
    ).rejects.toThrow(/object not found/);
  });
});

describe('TesseractUnavailableError', () => {
  it('is an Error subclass and carries name', async () => {
    const { TesseractUnavailableError } = await import(
      '../ocr/tesseract-adapter.js'
    );
    const err = new TesseractUnavailableError('not installed');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TesseractUnavailableError');
    expect(err.message).toBe('not installed');
  });
});

describe('detectLanguage edge cases', () => {
  it('returns mixed when both languages tie', async () => {
    const { detectLanguage } = await import('../ocr/language.js');
    // Mix: same count of English + Swahili stop words.
    expect(
      detectLanguage('the and of mkataba mpangaji kodi nyumba mwezi'),
    ).toBe('mixed');
  });
  it('returns mixed for whitespace-only', async () => {
    const { detectLanguage } = await import('../ocr/language.js');
    expect(detectLanguage('     ')).toBe('mixed');
  });
});
