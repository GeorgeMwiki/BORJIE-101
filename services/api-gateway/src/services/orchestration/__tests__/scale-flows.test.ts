import { describe, expect, it } from 'vitest';

import {
  flowBucketFor,
  SCALE_FLOW_SELECTORS,
  selectIncidentFlow,
  selectLicenceRenewalFlow,
  selectLoiFlow,
} from '../scale-flows.js';

const LOI_INTENT = {
  counterpartyName: 'Acme Buyers Ltd',
  mineral: 'Au',
  tonnes: 4,
  pricePerGramTzs: 180_000,
  recipientEmail: 'buyer@example.com',
};

const INCIDENT_INTENT = {
  siteId: 'site-mwadui',
  severity: 'medium' as const,
  summary: 'Compressor overheating in pit 3',
  affectedShipmentId: 'shp-101',
};

const LICENCE_INTENT = {
  licenceId: 'lic-001',
  documentDraftId: 'draft-001',
};

describe('scale-flows', () => {
  describe('flowBucketFor', () => {
    it('T1 / T2 map to lite', () => {
      expect(flowBucketFor('t1_artisanal')).toBe('lite');
      expect(flowBucketFor('t2_cooperative')).toBe('lite');
    });

    it('T3 maps to canonical', () => {
      expect(flowBucketFor('t3_midtier')).toBe('canonical');
    });

    it('T4 / T5 map to extended', () => {
      expect(flowBucketFor('t4_industrial')).toBe('extended');
      expect(flowBucketFor('t5_multi_country')).toBe('extended');
    });

    it('unknown tier coerces to T1 lite', () => {
      expect(flowBucketFor('not_a_tier')).toBe('lite');
      expect(flowBucketFor(null)).toBe('lite');
      expect(flowBucketFor(undefined)).toBe('lite');
    });
  });

  describe('selectLoiFlow', () => {
    it('T1 owner gets 2-step lite LOI (compose → send)', () => {
      const dag = selectLoiFlow(LOI_INTENT, { scaleTier: 't1_artisanal' });
      const ids = dag.steps.map((s) => s.id);
      expect(ids).toEqual(['compose', 'send']);
      expect(dag.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['compose->send']);
    });

    it('T3 owner gets canonical 4-step LOI', () => {
      const dag = selectLoiFlow(LOI_INTENT, { scaleTier: 't3_midtier' });
      const ids = dag.steps.map((s) => s.id);
      expect(ids).toEqual(['compose', 'lock', 'share', 'send']);
    });

    it('T5 owner still gets the canonical flow (no extra projection)', () => {
      const dag = selectLoiFlow(LOI_INTENT, { scaleTier: 't5_multi_country' });
      expect(dag.steps).toHaveLength(4);
    });
  });

  describe('selectIncidentFlow', () => {
    it('T2 owner gets report-only lite flow', () => {
      const dag = selectIncidentFlow(INCIDENT_INTENT, {
        scaleTier: 't2_cooperative',
      });
      expect(dag.steps.map((s) => s.id)).toEqual(['report']);
      expect(dag.edges).toEqual([]);
    });

    it('T4 owner gets canonical 3-step flow (report → escalate → notify_buyer)', () => {
      const dag = selectIncidentFlow(INCIDENT_INTENT, {
        scaleTier: 't4_industrial',
      });
      expect(dag.steps.map((s) => s.id)).toEqual([
        'report',
        'escalate',
        'notify_buyer',
      ]);
    });
  });

  describe('selectLicenceRenewalFlow', () => {
    it('T1 owner gets 2-step lite renewal (start → submit)', () => {
      const dag = selectLicenceRenewalFlow(LICENCE_INTENT, {
        scaleTier: 't1_artisanal',
      });
      expect(dag.steps.map((s) => s.id)).toEqual(['start', 'submit']);
    });

    it('T3 owner gets canonical 3-step renewal', () => {
      const dag = selectLicenceRenewalFlow(LICENCE_INTENT, {
        scaleTier: 't3_midtier',
      });
      expect(dag.steps.map((s) => s.id)).toEqual(['start', 'upload', 'submit']);
    });
  });

  describe('SCALE_FLOW_SELECTORS registry', () => {
    it('exposes all five flow selectors by name', () => {
      expect(Object.keys(SCALE_FLOW_SELECTORS).sort()).toEqual([
        'dispatchRfbToManagerChain',
        'draftSignAndSendLoi',
        'incidentToReportToBuyer',
        'licenceRenewalChain',
        'settleAndPayoutCoop',
      ]);
    });
  });
});
