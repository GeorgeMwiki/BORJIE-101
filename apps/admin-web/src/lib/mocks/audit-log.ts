import type { AuditEvent } from './types';

const SAMPLE_EVENTS: ReadonlyArray<Omit<AuditEvent, 'id' | 'at'>> = [
  {
    tenantId: 'tnt_geita_dhahabu',
    tenant: 'Geita Dhahabu Mines',
    actor: 'op_grace',
    action: 'prompt.promote',
    target: 'geology-v18 → production',
  },
  {
    tenantId: 'tnt_kahama_shaba',
    tenant: 'Kahama Shaba Holdings',
    actor: 'op_mwita',
    action: 'tenant.impersonate.start',
  },
  {
    tenantId: 'tnt_mererani',
    tenant: 'Mererani Tanzanite Cluster',
    actor: 'system',
    action: 'compliance.flag',
    target: 'missing NEMC renewal',
  },
  {
    tenantId: 'tnt_kiwira',
    tenant: 'Kiwira Coltan Cooperative',
    actor: 'op_grace',
    action: 'flag.toggle',
    target: 'sales.draftLoI ON',
  },
  {
    tenantId: 'tnt_kabanga',
    tenant: 'Kabanga Nickel Society',
    actor: 'system',
    action: 'killswitch.degraded',
    target: 'fx-junior',
  },
  {
    tenantId: 'tnt_lake_zone_gold',
    tenant: 'Lake Zone Gold Network',
    actor: 'op_naima',
    action: 'tenant.activate',
  },
];

export function buildMockAuditLog(): ReadonlyArray<AuditEvent> {
  const base = Date.parse('2026-05-25T09:14:22Z');
  const out: AuditEvent[] = [];
  for (let i = 0; i < 150; i += 1) {
    const s = SAMPLE_EVENTS[i % SAMPLE_EVENTS.length]!;
    out.push({
      ...s,
      id: `evt_${String(9999 - i).padStart(5, '0')}`,
      at: new Date(base - i * 4 * 60_000).toISOString(),
    });
  }
  return out;
}

export const MOCK_AUDIT_LOG = buildMockAuditLog();
