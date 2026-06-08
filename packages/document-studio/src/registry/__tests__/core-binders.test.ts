/**
 * Coverage for the core doc-type binders — drives licence_application,
 * royalty_statement, and monthly_owner_report through the full studio so
 * the existing builders' view transforms are exercised end-to-end (data
 * binding → render → citation gate → archive).
 */

import { describe, expect, it } from 'vitest';
import { createDocumentStudioWithCoreTypes } from '../../index.js';
import type { Citation } from '../../types.js';
import { toRoyaltyStatementView } from '../../templates/royalty-statement/builder.js';
import { toLicenceApplicationView } from '../../templates/licence-application/builder.js';
import { extractText } from '../../pipeline/locale-purity.js';

/** Money-token regex mirroring the structured citation gate. */
const MONEY_RE =
  /\b(?:USD|TZS|KES|UGX|NGN|RWF|ZAR)\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g;

/** Build citations covering every money figure a view renders. */
function coveringCitations(view: unknown): Citation[] {
  const text = extractText(view);
  const tokens = new Set<string>();
  MONEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY_RE.exec(text)) !== null) tokens.add(m[0]);
  return [...tokens].map((claim, i) => ({
    id: `F${i}`,
    claim,
    source: { kind: 'computation', ref: `ref:${i}` },
  }));
}

describe('core binder — royalty_statement (Typst, structured citations)', () => {
  it('generates a PDF with claim-covered figures + archives it', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const data = {
      locale: 'en' as const,
      currencyCode: 'TZS',
      producer: {
        name: 'Geita Co-op',
        licenceNo: 'PML-1',
        tin: '123-456',
        address: 'Geita',
      },
      statement: {
        statementNo: 'RS-1',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        dateIssued: '2026-06-01',
        issuedBy: 'Borjie',
      },
      shipments: [
        {
          shipmentRef: 'SH-1',
          date: '2026-05-10',
          mineral: 'Gold',
          quantity: 5,
          unit: 'kg',
          grossValue: 1_000_000,
          royaltyRatePct: 6,
          inspectionFeeRatePct: 1,
        },
      ],
      citations: [],
    };
    const out = await studio.generate({
      docType: 'royalty_statement',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data,
      citations: coveringCitations(toRoyaltyStatementView(data)),
      bucket: 'documents',
    });
    expect(out.docType).toBe('royalty_statement');
    expect(out.artifacts[0]!.format).toBe('pdf');
    expect(out.artifacts[0]!.archived.currencyCode).toBe('TZS');
  });
});

describe('core binder — licence_application (Typst)', () => {
  it('generates a PDF and seals the WORM chain', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const data = {
      locale: 'sw' as const,
      currencyCode: 'TZS',
      applicant: {
        name: 'Asha M',
        applicantType: 'individual' as const,
        nationalIdOrTin: 'ID-1',
        nationality: 'Tanzanian',
        address: 'Geita',
      },
      licence: {
        type: 'PML' as const,
        primaryMineral: 'Gold',
        areaHectares: 10,
        durationYears: 7,
        region: 'Geita',
        district: 'Geita',
        localityDescription: 'Near river',
      },
      beacons: [
        { beaconNo: 'B1', latitude: -2.87, longitude: 32.23 },
        { beaconNo: 'B2', latitude: -2.88, longitude: 32.24 },
        { beaconNo: 'B3', latitude: -2.89, longitude: 32.25 },
      ],
      workProgramme: { summary: 'Pilot', proposedExpenditure: 5_000_000 },
      fees: { applicationFee: 100_000, annualRentPerHectare: 10_000 },
      submission: {
        referenceNo: 'REF-1',
        dateSubmitted: '2026-06-01',
        submittedBy: 'Borjie',
      },
      citations: [],
    };
    const out = await studio.generate({
      docType: 'licence_application',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data,
      citations: coveringCitations(toLicenceApplicationView(data)),
      bucket: 'documents',
    });
    expect(out.locale).toBe('sw');
    expect(out.artifacts[0]!.archived.language).toBe('sw');
  });
});

describe('core binder — monthly_owner_report (Carbone docx+pdf)', () => {
  it('generates docx + pdf via the Carbone path', async () => {
    const studio = createDocumentStudioWithCoreTypes({ useStub: true });
    const out = await studio.generate({
      docType: 'monthly_owner_report',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      data: {
        period: { start: '2026-05-01', end: '2026-05-31' },
        property: { id: 'p1', name: 'Geita Block', address: 'Geita' },
        owner: {
          id: 'o1',
          name: 'Mwikila',
          email: 'owner@example.com',
          currencyPref: 'TZS',
        },
        summary: {
          rentCollected: 487_000,
          expenses: 92_000,
          netOwner: 395_000,
          occupancyPct: 88,
        },
        units: [
          {
            unitNumber: 'A1',
            tenantName: 'Tenant A',
            rentDue: 100_000,
            rentPaid: 100_000,
          },
        ],
      },
      bucket: 'documents',
    });
    expect(out.artifacts.map((a) => a.format).sort()).toEqual(['docx', 'pdf']);
    expect(out.currencyCode).toBe('TZS');
  });
});
