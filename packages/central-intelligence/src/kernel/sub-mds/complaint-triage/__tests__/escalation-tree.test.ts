import { describe, expect, it } from 'vitest';
import { escalateWhenNeeded } from '../tools/escalate-when-needed.js';
import { routeComplaint } from '../tools/route-complaint.js';
import { empathizeResponse } from '../tools/empathize-response.js';

describe('escalateWhenNeeded', () => {
  it('critical safety → owner-direct-phone within 60 min', () => {
    const r = escalateWhenNeeded({ category: 'safety', severity: 'critical' });
    expect(r.channel).toBe('owner-direct-phone');
    expect(r.slaMinutes).toBeLessThanOrEqual(60);
    expect(r.tags).toContain('safety');
    expect(r.mustNotifyOwner).toBe(true);
  });

  it('fair-treatment → owner phone + legal tag', () => {
    const r = escalateWhenNeeded({ category: 'fair-treatment', severity: 'urgent' });
    expect(r.channel).toBe('owner-direct-phone');
    expect(r.tags).toContain('legal');
    expect(r.mustNotifyOwner).toBe(true);
  });

  it('privacy → owner phone + legal tag', () => {
    const r = escalateWhenNeeded({ category: 'privacy', severity: 'urgent' });
    expect(r.channel).toBe('owner-direct-phone');
    expect(r.tags).toContain('legal');
  });

  it('urgent maintenance → maintenance-fast-lane', () => {
    const r = escalateWhenNeeded({ category: 'maintenance', severity: 'urgent' });
    expect(r.channel).toBe('maintenance-fast-lane');
    expect(r.mustNotifyOwner).toBe(false);
  });

  it('urgent billing → billing-fast-lane', () => {
    const r = escalateWhenNeeded({ category: 'billing', severity: 'urgent' });
    expect(r.channel).toBe('billing-fast-lane');
  });

  it('chatter never escalates', () => {
    const r = escalateWhenNeeded({ category: 'other', severity: 'chatter' });
    expect(r.channel).toBe('standard-queue');
    expect(r.mustNotifyOwner).toBe(false);
    expect(r.tags.length).toBe(0);
  });

  it('neighbor-noise non-chatter → community tag standard queue', () => {
    const r = escalateWhenNeeded({ category: 'neighbor-noise', severity: 'standard' });
    expect(r.channel).toBe('standard-queue');
    expect(r.tags).toContain('community');
  });
});

describe('routeComplaint', () => {
  it('safety → owner-direct p0', () => {
    const r = routeComplaint({ category: 'safety', severity: 'critical' });
    expect(r.desk).toBe('owner-direct');
    expect(r.priority).toBe('p0');
  });

  it('billing standard → billing-desk p2', () => {
    const r = routeComplaint({ category: 'billing', severity: 'standard' });
    expect(r.desk).toBe('billing-desk');
    expect(r.priority).toBe('p2');
  });

  it('fair-treatment → legal-review', () => {
    const r = routeComplaint({ category: 'fair-treatment', severity: 'urgent' });
    expect(r.desk).toBe('legal-review');
  });

  it('neighbor-noise → community-desk', () => {
    const r = routeComplaint({ category: 'neighbor-noise', severity: 'standard' });
    expect(r.desk).toBe('community-desk');
  });

  it('SLA scales with priority', () => {
    const p0 = routeComplaint({ category: 'safety', severity: 'critical' });
    const p3 = routeComplaint({ category: 'other', severity: 'chatter' });
    expect(p0.slaMinutes).toBeLessThan(p3.slaMinutes);
  });
});

describe('empathizeResponse', () => {
  it('drafts apologetic tone for angry', () => {
    const d = empathizeResponse({
      category: 'billing',
      sentiment: 'angry',
      language: 'en',
      referenceId: 'C-100',
    });
    expect(d.tone).toBe('apologetic');
    expect(d.autoSendable).toBe(false);
    expect(d.draftStatus).toBe('queued-for-owner-review');
    expect(d.body).toContain('C-100');
  });

  it('drafts Swahili reply when language=sw', () => {
    const d = empathizeResponse({
      category: 'maintenance',
      sentiment: 'frustrated',
      language: 'sw',
      referenceId: 'C-200',
    });
    expect(d.body).toMatch(/Habari|kumbukumbu/);
    expect(d.body).toContain('matengenezo');
  });

  it('drafts thankful tone for appreciative', () => {
    const d = empathizeResponse({
      category: 'other',
      sentiment: 'appreciative',
      language: 'en',
      referenceId: 'C-300',
    });
    expect(d.tone).toBe('thankful');
  });

  it('never auto-sendable, regardless of inputs', () => {
    const d = empathizeResponse({
      category: 'safety',
      sentiment: 'neutral',
      language: 'en',
      referenceId: 'C-400',
    });
    expect(d.autoSendable).toBe(false);
  });
});
