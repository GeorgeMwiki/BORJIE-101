import type { ComplianceItem } from './types';

export const MOCK_COMPLIANCE_QUEUE: ReadonlyArray<ComplianceItem> = [
  {
    id: 'q_001',
    tenantId: 'tnt_mererani',
    tenant: 'Mererani Tanzanite Cluster',
    summary: 'NEMC renewal expiring in 14 days; auto-warn fired',
    severity: 'Medium',
    waitingHours: 2,
  },
  {
    id: 'q_002',
    tenantId: 'tnt_geita_dhahabu',
    tenant: 'Geita Dhahabu Mines',
    summary: 'Royalty calculation diverges from Mining Act s.42 by 0.4%',
    severity: 'High',
    waitingHours: 6,
  },
  {
    id: 'q_003',
    tenantId: 'tnt_kiwira',
    tenant: 'Kiwira Coltan Cooperative',
    summary: 'Local content reg.18 documentation incomplete',
    severity: 'Low',
    waitingHours: 18,
  },
  {
    id: 'q_004',
    tenantId: 'tnt_kabanga',
    tenant: 'Kabanga Nickel Society',
    summary: 'EIA reg.7 community consent threshold not met',
    severity: 'High',
    waitingHours: 26,
  },
  {
    id: 'q_005',
    tenantId: 'tnt_lake_zone_gold',
    tenant: 'Lake Zone Gold Network',
    summary: 'BoT Circular 12 art.3 repatriation window missed',
    severity: 'Medium',
    waitingHours: 4,
  },
];
