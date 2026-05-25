import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutonomousActionAudit,
  InMemoryAutonomousActionAuditRepository,
} from '../../autonomy/index.js';

const TENANT = 'tenant_audit_1';

describe('AutonomousActionAudit', () => {
  let audit: AutonomousActionAudit;
  let repo: InMemoryAutonomousActionAuditRepository;

  beforeEach(() => {
    repo = new InMemoryAutonomousActionAuditRepository();
    audit = new AutonomousActionAudit({ repository: repo });
  });

  it('records an autonomous action with reasoning + evidence + confidence', async () => {
    const row = await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr_mwikila',
      action: 'send_reminder',
      domain: 'finance',
      reasoning: 'Day-5 reminder — under autonomy policy.',
      evidenceRefs: [{ kind: 'invoice', id: 'inv_1' }],
      confidence: 0.92,
      policyRuleMatched: 'finance.auto_send_reminders',
    });
    expect(row.tenantId).toBe(TENANT);
    expect(row.confidence).toBe(0.92);
    expect(row.evidenceRefs).toHaveLength(1);
    expect(row.policyRuleMatched).toBe('finance.auto_send_reminders');
  });

  it('clamps confidence to [0,1]', async () => {
    const high = await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr_mwikila',
      action: 'x',
      domain: 'finance',
      reasoning: 'r',
      confidence: 5,
    });
    const low = await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr_mwikila',
      action: 'x',
      domain: 'finance',
      reasoning: 'r',
      confidence: -1,
    });
    expect(high.confidence).toBe(1);
    expect(low.confidence).toBe(0);
  });

  it('list filters by domain and since', async () => {
    await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr',
      action: 'a',
      domain: 'finance',
      reasoning: 'r',
      confidence: 0.8,
    });
    await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr',
      action: 'b',
      domain: 'maintenance',
      reasoning: 'r',
      confidence: 0.8,
    });
    const finance = await audit.list(TENANT, { domain: 'finance' });
    expect(finance).toHaveLength(1);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const future = await audit.list(TENANT, { since: tomorrow });
    expect(future).toHaveLength(0);
  });

  it('countThisWeek counts only recent rows', async () => {
    await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr',
      action: 'a',
      domain: 'finance',
      reasoning: 'r',
      confidence: 0.8,
    });
    const count = await audit.countThisWeek(TENANT);
    expect(count).toBe(1);
  });

  it('links chainId via chainAppender when provided', async () => {
    const auditWithChain = new AutonomousActionAudit({
      repository: repo,
      chainAppender: async () => 'chain_abc',
    });
    const row = await auditWithChain.record({
      tenantId: TENANT,
      actorPersona: 'mr',
      action: 'a',
      domain: 'finance',
      reasoning: 'r',
      confidence: 0.8,
    });
    expect(row.chainId).toBe('chain_abc');
  });

  it('is tenant-isolated — never leaks rows between tenants', async () => {
    await audit.record({
      tenantId: TENANT,
      actorPersona: 'mr',
      action: 'a',
      domain: 'finance',
      reasoning: 'r',
      confidence: 0.9,
    });
    await audit.record({
      tenantId: 'other',
      actorPersona: 'mr',
      action: 'a',
      domain: 'finance',
      reasoning: 'r',
      confidence: 0.9,
    });
    const rows = await audit.list(TENANT);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(TENANT);
  });
});
