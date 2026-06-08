/**
 * Coverage for the legacy per-format builders (`build*`). These predate
 * the studio pipeline (which uses the `to*View` transforms directly) but
 * remain exported, so they are exercised here: the render loop, the
 * format guard, and the renderer-error propagation branch.
 */

import { describe, expect, it } from 'vitest';
import { TypstRenderer } from '../../renderers/typst-renderer.js';
import { CarboneRenderer } from '../../renderers/carbone-renderer.js';
import { errorOutput } from '../../renderers/carbone-renderer.js';
import {
  buildRoyaltyStatement,
} from '../royalty-statement/builder.js';
import { buildLicenceApplication } from '../licence-application/builder.js';
import { buildMonthlyOwnerReport } from '../monthly-owner-report/builder.js';
import type { Renderer, RendererInput, RendererOutput } from '../../types.js';

const stubTypst = new TypstRenderer({ useStub: true });
const stubCarbone = new CarboneRenderer({ useStub: true });

const royaltyData = {
  locale: 'en' as const,
  currencyCode: 'TZS',
  producer: { name: 'Co', licenceNo: 'L1', tin: 'T1', address: 'A' },
  statement: {
    statementNo: 'RS-1',
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    dateIssued: '2026-06-01',
    issuedBy: 'Borjie',
  },
  shipments: [
    {
      shipmentRef: 'S1',
      date: '2026-05-10',
      mineral: 'Gold',
      quantity: 2,
      unit: 'kg',
      grossValue: 500_000,
      royaltyRatePct: 6,
    },
  ],
  citations: [],
};

const licenceData = {
  locale: 'en' as const,
  currencyCode: 'TZS',
  applicant: {
    name: 'A',
    applicantType: 'company' as const,
    nationalIdOrTin: 'TIN',
    nationality: 'TZ',
    address: 'Addr',
    companyRegNo: 'C-1',
  },
  licence: {
    type: 'PL' as const,
    primaryMineral: 'Gold',
    otherMinerals: ['Copper'],
    areaHectares: 5,
    durationYears: 4,
    region: 'R',
    district: 'D',
    ward: 'W',
    localityDescription: 'Loc',
  },
  beacons: [
    { beaconNo: 'B1', latitude: 1, longitude: 2 },
    { beaconNo: 'B2', latitude: 1.1, longitude: 2.1 },
    { beaconNo: 'B3', latitude: 1.2, longitude: 2.2 },
  ],
  workProgramme: {
    summary: 'WP',
    proposedExpenditure: 1_000_000,
    equipment: ['Drill'],
    estimatedJobs: 10,
  },
  fees: { applicationFee: 50_000, annualRentPerHectare: 5_000, preparationFee: 1_000 },
  submission: { referenceNo: 'REF', dateSubmitted: '2026-06-01', submittedBy: 'B' },
  citations: [],
};

const monthlyData = {
  period: { start: '2026-05-01', end: '2026-05-31' },
  property: { id: 'p', name: 'N', address: 'A' },
  owner: { id: 'o', name: 'O', email: 'o@e.com', currencyPref: 'TZS' },
  summary: { rentCollected: 1, expenses: 0, netOwner: 1, occupancyPct: 90 },
  units: [{ unitNumber: 'U1', tenantName: 'T', rentDue: 1, rentPaid: 1 }],
};

describe('legacy buildRoyaltyStatement', () => {
  it('renders a PDF artifact', async () => {
    const out = await buildRoyaltyStatement({ data: royaltyData, renderer: stubTypst });
    expect(out[0]!.format).toBe('pdf');
    expect(out[0]!.sha256).toHaveLength(64);
  });
  it('rejects a non-pdf format', async () => {
    await expect(
      buildRoyaltyStatement({ data: royaltyData, formats: ['docx'], renderer: stubTypst }),
    ).rejects.toThrow(/pdf only/);
  });
  it('propagates a renderer error', async () => {
    const failing: Renderer = {
      id: 'x',
      async render(_i: RendererInput): Promise<RendererOutput> {
        return errorOutput({ code: 'binary_failed', message: 'boom', origin: 'x' });
      },
    };
    await expect(
      buildRoyaltyStatement({ data: royaltyData, renderer: failing }),
    ).rejects.toThrow(/render failed/);
  });
});

describe('legacy buildLicenceApplication', () => {
  it('renders a PDF with company + optional fields', async () => {
    const out = await buildLicenceApplication({ data: licenceData, renderer: stubTypst });
    expect(out[0]!.format).toBe('pdf');
  });
  it('rejects a non-pdf format', async () => {
    await expect(
      buildLicenceApplication({ data: licenceData, formats: ['xlsx'], renderer: stubTypst }),
    ).rejects.toThrow(/pdf only/);
  });
});

describe('legacy buildMonthlyOwnerReport', () => {
  it('renders docx + pdf', async () => {
    const out = await buildMonthlyOwnerReport({ data: monthlyData, renderer: stubCarbone });
    expect(out.map((a) => a.format).sort()).toEqual(['docx', 'pdf']);
  });
  it('rejects an unsupported format', async () => {
    await expect(
      buildMonthlyOwnerReport({ data: monthlyData, formats: ['xlsx'], renderer: stubCarbone }),
    ).rejects.toThrow(/docx\|pdf only/);
  });
});
