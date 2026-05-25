/**
 * LMBM (Living Mining Business Map) graph mocks.
 *
 * Force-directed graph of the owner's company, licences, sites,
 * documents, people, events. Each node carries provenance so the
 * detail panel can show "who/what last wrote this and from where".
 *
 * Numbers and labels are deliberately Geita/Mbeya-flavoured so the
 * graph reads correctly during demo without a backend.
 */

export type LmbmNodeKind =
  | 'company'
  | 'licence'
  | 'site'
  | 'document'
  | 'person'
  | 'event';

export interface LmbmNode {
  readonly id: string;
  readonly kind: LmbmNodeKind;
  readonly label: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly attributes: Record<string, string | number>;
  readonly evidence: ReadonlyArray<{
    readonly source: string;
    readonly excerpt: string;
    readonly confidence: number;
  }>;
}

export interface LmbmEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
}

export interface LmbmGraph {
  readonly nodes: ReadonlyArray<LmbmNode>;
  readonly edges: ReadonlyArray<LmbmEdge>;
  readonly asOf: string;
}

export const LMBM_MOCK: LmbmGraph = {
  asOf: '2026-05-25',
  nodes: [
    {
      id: 'co_mawebora',
      kind: 'company',
      label: 'Mawe Bora Mining Ltd',
      validFrom: '2018-04-12',
      validTo: null,
      attributes: {
        tin: '128-456-789',
        directors: 3,
        region: 'Geita',
      },
      evidence: [
        {
          source: 'BRELA certificate (uploaded 2024-09-04)',
          excerpt: 'Registered under Tanzanian Companies Act 2002.',
          confidence: 0.99,
        },
      ],
    },
    {
      id: 'lic_25434',
      kind: 'licence',
      label: 'PML 25434 — Nyakabale',
      validFrom: '2023-03-27',
      validTo: '2030-03-26',
      attributes: {
        area_ha: 8.7,
        annual_rent_tzs: 1_200_000,
        mineral: 'gold',
      },
      evidence: [
        {
          source: 'PML 25434 grant letter (Ministry, 2023-03-27)',
          excerpt: 'Primary Mining Licence granted for an initial term of 7 years.',
          confidence: 0.97,
        },
      ],
    },
    {
      id: 'lic_28102',
      kind: 'licence',
      label: 'PML 28102 — Kakola',
      validFrom: '2024-08-01',
      validTo: '2031-07-31',
      attributes: {
        area_ha: 6.2,
        annual_rent_tzs: 900_000,
        mineral: 'gold',
      },
      evidence: [
        {
          source: 'PML 28102 grant letter (Ministry, 2024-08-01)',
          excerpt: 'Alluvial terrace block, no underground workings approved.',
          confidence: 0.96,
        },
      ],
    },
    {
      id: 'site_nyakabale',
      kind: 'site',
      label: 'Nyakabale Reef Block',
      validFrom: '2023-04-10',
      validTo: null,
      attributes: { headcount: 32, mineral: 'gold' },
      evidence: [
        {
          source: 'Site survey 2024-Q4',
          excerpt: 'Reef strike 045°, average vein width 1.6 m.',
          confidence: 0.91,
        },
      ],
    },
    {
      id: 'site_kakola',
      kind: 'site',
      label: 'Kakola Alluvial Terraces',
      validFrom: '2024-09-15',
      validTo: null,
      attributes: { headcount: 18, mineral: 'gold' },
      evidence: [
        {
          source: 'Topo survey 2025-Q1',
          excerpt: 'Three terrace levels, basal gravel target.',
          confidence: 0.88,
        },
      ],
    },
    {
      id: 'site_mbeya',
      kind: 'site',
      label: 'Mbeya Ridge Pit 2',
      validFrom: '2025-02-01',
      validTo: null,
      attributes: { headcount: 11, mineral: 'coltan' },
      evidence: [
        {
          source: 'Reconnaissance 2025-01',
          excerpt: 'Pegmatite-hosted Ta-Nb mineralisation, grab samples 0.18% Ta2O5.',
          confidence: 0.74,
        },
      ],
    },
    {
      id: 'doc_epp_2025',
      kind: 'document',
      label: 'EPP report 2025',
      validFrom: '2025-02-14',
      validTo: null,
      attributes: { pages: 38, hash: 'sha256:c91a…' },
      evidence: [
        {
          source: 'Environmental Protection Plan filed with NEMC',
          excerpt: 'Approved with two conditions on tailings monitoring.',
          confidence: 0.94,
        },
      ],
    },
    {
      id: 'person_manager',
      kind: 'person',
      label: 'Hawa Shabani — Mine Manager',
      validFrom: '2024-01-02',
      validTo: null,
      attributes: { role: 'mine_manager', tickets: 'MM-T3' },
      evidence: [
        {
          source: 'HR onboarding pack 2024-01',
          excerpt: 'Qualified Mine Manager — Ticket 3 (MEM).',
          confidence: 0.99,
        },
      ],
    },
    {
      id: 'evt_renewal_window',
      kind: 'event',
      label: 'PML 25434 renewal window',
      validFrom: '2026-06-10',
      validTo: '2026-07-25',
      attributes: { type: 'licence_renewal_window' },
      evidence: [
        {
          source: 'Renewal scheduler (LicenceAgent)',
          excerpt: '47 days until window opens; checklist 60% complete.',
          confidence: 0.92,
        },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'co_mawebora', target: 'lic_25434', relation: 'holds' },
    { id: 'e2', source: 'co_mawebora', target: 'lic_28102', relation: 'holds' },
    { id: 'e3', source: 'lic_25434', target: 'site_nyakabale', relation: 'covers' },
    { id: 'e4', source: 'lic_28102', target: 'site_kakola', relation: 'covers' },
    { id: 'e5', source: 'co_mawebora', target: 'site_mbeya', relation: 'operates' },
    { id: 'e6', source: 'site_nyakabale', target: 'doc_epp_2025', relation: 'documented_by' },
    { id: 'e7', source: 'co_mawebora', target: 'person_manager', relation: 'employs' },
    { id: 'e8', source: 'lic_25434', target: 'evt_renewal_window', relation: 'has_event' },
  ],
};
