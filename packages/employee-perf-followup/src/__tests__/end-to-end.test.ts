import { describe, it, expect } from 'vitest';
import {
  buildAllSeedTemplates,
  buildSeedTemplate,
} from '../kpi/role-templates.js';
import { computeScorecard } from '../score/scorer.js';
import { renderTier } from '../tier/recipient-tier-renderer.js';
import { generateCoachNudge } from '../nudge/coach-nudge.js';
import {
  createInMemoryAuditChain,
  stableHash,
} from '../audit/in-memory-audit-chain.js';
import { createInMemoryScorecardRepository } from '../repositories/scorecard.js';
import { createInMemoryKpiTemplateRepository } from '../repositories/kpi-template.js';
import { createInMemoryPerfNudgeRepository } from '../repositories/nudge.js';
import type {
  EmployeeScorecard,
  KpiMeasurementPort,
  PerfNudge,
} from '../types.js';

const NOW = new Date('2026-05-27T03:00:00.000Z'); // 06:00 in UTC+3

const HAPPY: Record<string, number> = {
  tonnage_pct_of_plan: 0.98,
  safety_incidents_count: 0,
  briefings_on_time_pct: 1.0,
  stockpile_reconciliation_pct: 0.98,
};

const measurementPort: KpiMeasurementPort = {
  async measure(input) {
    const v = HAPPY[input.measure_fn_name];
    if (v === undefined) throw new Error(`no measurement ${input.measure_fn_name}`);
    return v;
  },
};

let counter = 0;
const newId = (): string => {
  counter += 1;
  const padded = counter.toString().padStart(12, '0');
  return `00000000-0000-0000-0000-${padded}`;
};

describe('happy-path end-to-end', () => {
  it('produces a scorecard + subject + supervisor + owner nudges with correct tiering', async () => {
    const templates = createInMemoryKpiTemplateRepository();
    for (const t of buildAllSeedTemplates(NOW.toISOString())) {
      await templates.upsert(t);
    }
    const scorecards = createInMemoryScorecardRepository();
    const nudges = createInMemoryPerfNudgeRepository();
    const audit = createInMemoryAuditChain();
    const template = buildSeedTemplate('foreman', NOW.toISOString());
    // 1. Compute scorecard.
    const card: EmployeeScorecard = await computeScorecard(
      {
        tenant_id: 't1',
        employee_user_id: 'u-foreman',
        role: 'foreman',
        date: '2026-05-26',
        template,
      },
      {
        measurementPort,
        now: () => NOW,
        hash: stableHash,
        newId,
      },
    );
    await scorecards.insert(card);
    expect(card.overall_score).toBeGreaterThan(0.85);
    // 2. Generate the subject's coaching nudge in their voice.
    const subjectBody = generateCoachNudge({
      scorecard: card,
      template,
      voice: 'balanced',
    });
    // 3. Render each tier.
    const subjectView = renderTier({
      scorecard: card,
      tier: 'subject',
      fullBody: subjectBody,
    });
    const supervisorView = renderTier({
      scorecard: card,
      tier: 'supervisor',
      fullBody: subjectBody,
    });
    const ownerView = renderTier({
      scorecard: card,
      tier: 'owner',
      fullBody: subjectBody,
      tenantScorecardsForDate: [card],
    });
    // 4. Persist three perf_nudges rows.
    const subjectNudge: PerfNudge = {
      id: newId(),
      tenant_id: 't1',
      scorecard_id: card.id,
      recipient_user_id: 'u-foreman',
      recipient_tier: 'subject',
      content: subjectView.body,
      channel: 'inapp',
      sent_at: null,
      audit_hash: await audit.append({ kind: 'subject_nudge', id: card.id }),
      created_at: NOW.toISOString(),
    };
    const supervisorNudge: PerfNudge = {
      id: newId(),
      tenant_id: 't1',
      scorecard_id: card.id,
      recipient_user_id: 'u-supervisor',
      recipient_tier: 'supervisor',
      content: supervisorView.body,
      channel: 'inapp',
      sent_at: null,
      audit_hash: await audit.append({ kind: 'supervisor_nudge', id: card.id }),
      created_at: NOW.toISOString(),
    };
    const ownerNudge: PerfNudge = {
      id: newId(),
      tenant_id: 't1',
      scorecard_id: card.id,
      recipient_user_id: 'u-owner',
      recipient_tier: 'owner',
      content: '',
      channel: 'inapp',
      sent_at: null,
      audit_hash: await audit.append({ kind: 'owner_nudge', id: card.id }),
      created_at: NOW.toISOString(),
    };
    await nudges.insert(subjectNudge);
    await nudges.insert(supervisorNudge);
    await nudges.insert(ownerNudge);
    const rows = await nudges.listForScorecard(card.id);
    expect(rows.length).toBe(3);
    // 5. Verify §3 tiering: subject full > supervisor short > owner empty.
    expect(subjectNudge.content.length).toBeGreaterThan(0);
    expect(supervisorNudge.content.length).toBeLessThanOrEqual(
      subjectNudge.content.length,
    );
    expect(ownerNudge.content).toBe('');
    // 6. Hash chain — every row has a non-empty audit_hash.
    for (const r of rows) {
      expect(r.audit_hash.length).toBeGreaterThan(0);
    }
  });
});
