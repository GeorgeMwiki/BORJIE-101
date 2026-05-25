import type { CorpusEntry } from './types';

export const MOCK_CORPUS: ReadonlyArray<CorpusEntry> = [
  {
    id: 'doc_geo_dossier',
    title: 'TZ Greenstone Belt — gold occurrence dossier',
    version: 'v4.2',
    status: 'Indexed',
    bytes: 4_182_330,
    indexedAt: '2026-05-12T09:14:00Z',
    chunks: 312,
  },
  {
    id: 'doc_coltan_2025',
    title: 'Mbeya coltan market brief Q2/2025',
    version: 'v1.0',
    status: 'Indexed',
    bytes: 481_220,
    indexedAt: '2026-05-08T14:00:00Z',
    chunks: 41,
  },
  {
    id: 'doc_tz_mining_act',
    title: 'Mining Act 2010 — consolidated',
    version: 'v7.1',
    status: 'Re-ingesting',
    bytes: 1_280_440,
    indexedAt: '2026-05-24T10:02:00Z',
    chunks: 188,
  },
  {
    id: 'doc_copper_assays',
    title: 'Kahama copper assay reference set',
    version: 'v2.0',
    status: 'Superseded',
    bytes: 880_120,
    indexedAt: '2025-12-18T11:30:00Z',
    chunks: 95,
  },
  {
    id: 'doc_tanzanite_grading',
    title: 'Tanzanite grading manual — TanzaniteOne',
    version: 'v1.4',
    status: 'Indexed',
    bytes: 2_100_500,
    indexedAt: '2026-03-22T07:45:00Z',
    chunks: 142,
  },
];
