import type { KillswitchRow } from './types';

export const MOCK_KILLSWITCH: ReadonlyArray<KillswitchRow> = [
  { juniorId: 'jr_master', junior: 'Master Brain', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_geology', junior: 'Geology', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_compliance', junior: 'Compliance', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_cost', junior: 'Cost Engineer', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_sales', junior: 'Sales', state: 'DEGRADED', updatedAt: '2026-05-25T08:12:00Z', updatedBy: 'op_mwita' },
  { juniorId: 'jr_fx', junior: 'FX / Treasury', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_hr', junior: 'HR', state: 'OK', updatedAt: '2026-05-25T07:00:00Z', updatedBy: 'op_grace' },
  { juniorId: 'jr_report', junior: 'Report Writer', state: 'HALT', updatedAt: '2026-05-22T15:30:00Z', updatedBy: 'op_naima' },
];
