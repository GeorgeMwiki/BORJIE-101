import type { Junior } from './types';

export const MOCK_JUNIORS: ReadonlyArray<Junior> = [
  { id: 'jr_master', name: 'Master Brain', role: 'Orchestrator', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_geology', name: 'Geology', role: 'Mineralogy & assays', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_compliance', name: 'Compliance', role: 'TZ regulatory', model: 'claude-opus-4-7', status: 'Active' },
  { id: 'jr_cost', name: 'Cost Engineer', role: 'Mine economics', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_sales', name: 'Sales', role: 'Buyer match + LoI', model: 'claude-haiku-4-5', status: 'Canary' },
  { id: 'jr_fx', name: 'FX / Treasury', role: 'TZS / USD hedging', model: 'claude-haiku-4-5', status: 'Active' },
  { id: 'jr_hr', name: 'HR', role: 'Attendance & payroll', model: 'claude-haiku-4-5', status: 'Active' },
  { id: 'jr_report', name: 'Report Writer', role: 'Letters & filings', model: 'claude-sonnet-4-5', status: 'Suspended' },
];
