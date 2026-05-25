import type { RegulatorChange } from './types';

export const MOCK_REGULATOR_PIPELINE: ReadonlyArray<RegulatorChange> = [
  { id: 'r_318', source: 'Gazette', title: 'GN. 318 — Royalty rate amendment (gold)', stage: 'incoming', ageHours: 2 },
  { id: 'r_421', source: 'NEMC', title: 'EIA reg.7 — community consent threshold', stage: 'reviewing', ageHours: 11 },
  { id: 'r_417', source: 'BoT', title: 'Circular 12/2026 — FX repatriation window', stage: 'reviewing', ageHours: 24 },
  { id: 'r_412', source: 'Tumemadini', title: 'PML-2026-042 grant notice', stage: 'approved', ageHours: 32 },
  { id: 'r_402', source: 'TRA', title: 'VAT (Mining) practice note revision 4/2026', stage: 'pushed', ageHours: 56 },
  { id: 'r_398', source: 'Gazette', title: 'GN. 304 — Local content amendment', stage: 'pushed', ageHours: 72 },
  { id: 'r_395', source: 'NEMC', title: 'Quarterly tailings monitoring template', stage: 'incoming', ageHours: 6 },
];
