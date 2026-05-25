import type { PromotionRow } from './types';

export const MOCK_PROMOTIONS: ReadonlyArray<PromotionRow> = [
  {
    id: 'pr_201',
    kind: 'Prompt',
    subject: 'Geology v17 → v18',
    promotedAt: '2026-05-25T09:14:00Z',
    canRevert: true,
    promotedBy: 'op_grace',
  },
  {
    id: 'pr_200',
    kind: 'Model',
    subject: 'Compliance: opus-4-7 swap',
    promotedAt: '2026-05-24T18:20:00Z',
    canRevert: true,
    promotedBy: 'op_mwita',
  },
  {
    id: 'pr_199',
    kind: 'Corpus',
    subject: 'Mining Act 2010 consolidated v7.1',
    promotedAt: '2026-05-24T10:02:00Z',
    canRevert: true,
    promotedBy: 'op_naima',
  },
  {
    id: 'pr_198',
    kind: 'Prompt',
    subject: 'Sales v3 → v4',
    promotedAt: '2026-05-20T08:00:00Z',
    canRevert: false,
    promotedBy: 'op_grace',
  },
  {
    id: 'pr_197',
    kind: 'Corpus',
    subject: 'TZ Greenstone Belt dossier v4.2',
    promotedAt: '2026-05-12T09:14:00Z',
    canRevert: false,
    promotedBy: 'op_zawadi',
  },
];
