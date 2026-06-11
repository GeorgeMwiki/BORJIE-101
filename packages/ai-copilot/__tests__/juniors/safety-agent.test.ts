import { describe, it, expect } from 'vitest';
import {
  createSafetyAgent,
  computeSafetyRates,
  verifyCriticalControls,
  buildIncidentHeatmap,
  computePpeCompliancePct,
  type IncidentRecord,
  type CriticalControlInput,
} from '../../src/juniors/safety-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

// Narrative-only LLM stub — rates/controls are deterministic regardless.
function claudeNarrative(): ClaudeClient {
  return {
    async complete() {
      return {
        content: JSON.stringify({
          site_id: 's1',
          rates: {
            hours_worked: 0,
            trifr: 0,
            ltifr: 0,
            aifr: 0,
            fatality_rate: 0,
            severity_rate: 0,
            recordable_count: 0,
            lost_time_count: 0,
            fatality_count: 0,
            denominator_insufficient: true,
          },
          critical_controls: [],
          controls_at_risk: 0,
          incident_heatmap: [],
          ppe_compliance_pct: 0,
          immediate_alerts: [],
          required_actions: ['Maintain toolbox-talk cadence.'],
          escalations: [],
          confidence: 0.9,
          rationale: 'narrative ok',
          evidence_ids: ['n1'],
          citations: ['ICMM Principle 5'],
        }),
      };
    },
  };
}

describe('safety-agent deterministic HSE engine', () => {
  describe('computeSafetyRates', () => {
    it('computes TRIFR/LTIFR/fatality-rate per million hours', () => {
      const incidents: IncidentRecord[] = [
        { incident_id: 'i1', iso_ts: '2026-01-01', kind: 'lost_time_injury', severity: 'high', site_id: 's1', description: 'fall', photo_evidence_ids: [], lost_days: 10 },
        { incident_id: 'i2', iso_ts: '2026-01-02', kind: 'first_aid', severity: 'low', site_id: 's1', description: 'cut', photo_evidence_ids: [], lost_days: 0 },
        { incident_id: 'i3', iso_ts: '2026-01-03', kind: 'medical_treatment', severity: 'medium', site_id: 's1', description: 'sprain', photo_evidence_ids: [], lost_days: 0 },
      ];
      const rates = computeSafetyRates(incidents, 1_000_000);
      // recordable = LTI + MTI = 2 → TRIFR 2.0
      expect(rates.trifr).toBe(2);
      // lost-time = LTI = 1 → LTIFR 1.0
      expect(rates.ltifr).toBe(1);
      // all injuries = 3 → AIFR 3.0
      expect(rates.aifr).toBe(3);
      expect(rates.fatality_rate).toBe(0);
      expect(rates.severity_rate).toBe(10);
      expect(rates.denominator_insufficient).toBe(false);
    });

    it('flags denominator_insufficient when hours_worked is 0 (no confabulated rate)', () => {
      const incidents: IncidentRecord[] = [
        { incident_id: 'i1', iso_ts: '2026-01-01', kind: 'fatality', severity: 'critical', site_id: 's1', description: 'x', photo_evidence_ids: [], lost_days: 0 },
      ];
      const rates = computeSafetyRates(incidents, 0);
      expect(rates.trifr).toBe(0);
      expect(rates.fatality_count).toBe(1);
      expect(rates.denominator_insufficient).toBe(true);
    });
  });

  describe('verifyCriticalControls', () => {
    const base: CriticalControlInput = {
      control_id: 'cc1',
      mue: 'fall-of-ground',
      control: 'ground support',
      owner: 'shift_boss',
      last_verified_iso: '2026-06-01',
      cadence_days: 7,
      field_result: 'pass',
    };
    it('marks a passing in-cadence control effective + verified', () => {
      const [s] = verifyCriticalControls([base], '2026-06-05');
      expect(s.status).toBe('effective');
      expect(s.verified).toBe(true);
      expect(s.overdue).toBe(false);
    });
    it('marks a failed field result as failed (last line of defence breached)', () => {
      const [s] = verifyCriticalControls([{ ...base, field_result: 'fail' }], '2026-06-05');
      expect(s.status).toBe('failed');
      expect(s.verified).toBe(false);
    });
    it('marks an overdue verification unknown', () => {
      const [s] = verifyCriticalControls([base], '2026-07-01');
      expect(s.status).toBe('unknown');
      expect(s.overdue).toBe(true);
    });
    it('marks a never-verified control unknown + overdue', () => {
      const [s] = verifyCriticalControls([{ ...base, last_verified_iso: null }], '2026-06-05');
      expect(s.status).toBe('unknown');
      expect(s.overdue).toBe(true);
      expect(s.days_since_verification).toBeNull();
    });
  });

  it('buildIncidentHeatmap weights by severity and sorts desc', () => {
    const incidents: IncidentRecord[] = [
      { incident_id: 'i1', iso_ts: '', kind: 'first_aid', severity: 'low', site_id: 's1', description: '', photo_evidence_ids: [], lost_days: 0, site_section: 'pit-a' },
      { incident_id: 'i2', iso_ts: '', kind: 'fatality', severity: 'critical', site_id: 's1', description: '', photo_evidence_ids: [], lost_days: 0, site_section: 'pit-b' },
    ];
    const heatmap = buildIncidentHeatmap(incidents);
    expect(heatmap[0]?.site_section).toBe('pit-b');
    expect(heatmap[0]?.severity_score).toBe(20);
  });

  it('computePpeCompliancePct = distinct covered / headcount', () => {
    const ppe = [
      { employee_id: 'e1', item: 'helmet', issued_at: '2026-01-01' },
      { employee_id: 'e1', item: 'boots', issued_at: '2026-01-01' },
      { employee_id: 'e2', item: 'helmet', issued_at: '2026-01-01' },
    ];
    expect(computePpeCompliancePct(ppe, 4)).toBe(50);
    expect(computePpeCompliancePct(ppe, 0)).toBe(0);
  });
});

describe('safety-agent factory', () => {
  it('ships deterministic rates + escalations for a fatality', async () => {
    const agent = createSafetyAgent({ claude: claudeNarrative() });
    const out = await agent.processInput({
      tenantId: 't1',
      siteId: 's1',
      hours_worked: 500_000,
      workforce_headcount: 10,
      recent_incidents: [
        { incident_id: 'inc_fatal', iso_ts: '2026-06-01', kind: 'fatality', severity: 'critical', site_id: 's1', description: 'haul-truck interaction', photo_evidence_ids: [], lost_days: 0, site_section: 'haul-road' },
      ],
      critical_controls: [
        { control_id: 'cc_veh', mue: 'vehicle-interaction', control: 'segregation', owner: 'foreman', last_verified_iso: null, cadence_days: 7, field_result: 'fail' },
      ],
    });
    expect(out.rates.fatality_count).toBe(1);
    expect(out.rates.fatality_rate).toBe(2); // 1 / 500000 * 1e6
    expect(out.evidence_ids).toContain('inc_fatal');
    // fatality → kill_switch escalation; failed control → four_eye escalation
    const prefixes = out.escalations.map((e) => e.policy_prefix);
    expect(prefixes).toContain('kill_switch');
    expect(prefixes).toContain('four_eye');
    expect(out.controls_at_risk).toBe(1);
    expect(out.immediate_alerts.some((a) => a.includes('FATALITY'))).toBe(true);
  });

  it('never has an empty evidence chain (Auditor base)', async () => {
    const agent = createSafetyAgent({ claude: claudeNarrative() });
    const out = await agent.processInput({ tenantId: 't1', siteId: 's1' });
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('falls back to deterministic envelope when the LLM narrative fails (HSE never goes dark)', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('icmm_lookup_fail'); } };
    const agent = createSafetyAgent({ claude });
    const out = await agent.processInput({
      tenantId: 't1',
      siteId: 's1',
      hours_worked: 1_000_000,
      recent_incidents: [
        { incident_id: 'i1', iso_ts: '2026-01-01', kind: 'lost_time_injury', severity: 'high', site_id: 's1', description: 'fall', photo_evidence_ids: [], lost_days: 5 },
      ],
    });
    // Deterministic rates still shipped despite LLM failure.
    expect(out.rates.ltifr).toBe(1);
    expect(out.evidence_ids).toContain('i1');
    expect(out.rationale).toMatch(/LTIFR/);
  });
});
