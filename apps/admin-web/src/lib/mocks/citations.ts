import type { Citation } from './types';

export const MOCK_CITATIONS: ReadonlyArray<Citation> = [
  {
    id: 'cit_mma_2010_s42',
    statute: 'Mining Act, 2010',
    section: 's.42 — Royalty rates',
    publishedOn: '2010-04-21',
    source: 'Gazette',
    excerpt:
      'A holder of a Mining Licence shall pay royalty on the gross value of all minerals produced at the prescribed rate.',
  },
  {
    id: 'cit_eia_2018_r7',
    statute: 'Environmental Mgmt (EIA & Audit) Regs',
    section: 'reg.7 — Community consent',
    publishedOn: '2018-11-09',
    source: 'NEMC',
    excerpt:
      'No certificate of environmental compliance shall be issued unless the proponent has demonstrably obtained free, prior and informed consent of the affected community.',
  },
  {
    id: 'cit_bot_fx_2024',
    statute: 'Foreign Exchange Circular 12 of 2024',
    section: 'art.3 — Repatriation window',
    publishedOn: '2024-08-02',
    source: 'BoT',
    excerpt:
      'Export proceeds shall be repatriated to a domestic account within 90 days of the bill of lading.',
  },
  {
    id: 'cit_tmaa_pml_2023',
    statute: 'Primary Mining Licence Notice',
    section: 'PML-2023-417',
    publishedOn: '2023-06-14',
    source: 'Tumemadini',
    excerpt:
      'Grant of Primary Mining Licence to the holder for a period of seven (7) years, subject to renewal and compliance with the Mining Act.',
  },
  {
    id: 'cit_local_2022',
    statute: 'Local Content Regulations 2022',
    section: 'reg.18 — Supplier quota',
    publishedOn: '2022-02-28',
    source: 'Gazette',
    excerpt:
      'A contractor shall procure goods and services from indigenous Tanzanian companies to the extent of at least eighty per centum (80%) of the contract value.',
  },
  {
    id: 'cit_tra_vat_2025',
    statute: 'VAT (Mining) Practice Note 4/2025',
    section: 'para.5',
    publishedOn: '2025-03-11',
    source: 'TRA',
    excerpt:
      'Input VAT on prospecting and exploration goods is deductible only against the supply of minerals attracting standard-rated VAT.',
  },
];
