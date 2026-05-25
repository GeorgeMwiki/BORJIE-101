import { describe, it, expect } from 'vitest';
import {
  AIPresenceManager,
  BehaviorObserver,
  ProactiveInterventionEngine,
  getPageContext,
  type BehaviorEvent,
} from '../../ambient-brain/index.js';

const T1 = 'tenant_alpha';
const T2 = 'tenant_bravo';
const U1 = 'user_one';
const U2 = 'user_two';

function baseEvent(
  partial: Partial<BehaviorEvent> & Pick<BehaviorEvent, 'type'>,
): BehaviorEvent {
  return {
    type: partial.type,
    timestamp: new Date().toISOString(),
    tenantId: T1,
    userId: U1,
    ...partial,
  } as BehaviorEvent;
}

describe('AmbientBrain: AIPresenceManager', () => {
  it('initialises presence with page context from registry', () => {
    const mgr = new AIPresenceManager();
    const state = mgr.start({
      tenantId: T1,
      userId: U1,
      portal: 'manager',
      initialPage: '/manager/leases/new',
    });
    expect(state.pageContext.pageType).toBe('lease_form');
    expect(state.overlayMode).toBe('floating');
  });

  it('updates page context on navigation', () => {
    const mgr = new AIPresenceManager();
    mgr.start({
      tenantId: T1,
      userId: U1,
      portal: 'owner',
      initialPage: '/owner/dashboard',
    });
    const next = mgr.updatePage(T1, U1, '/manager/maintenance');
    expect(next.pageContext.pageType).toBe('maintenance_triage');
  });

  it('tenant isolation: tenant A cannot see tenant B presence', () => {
    const mgr = new AIPresenceManager();
    mgr.start({
      tenantId: T1,
      userId: U1,
      portal: 'manager',
      initialPage: '/manager/properties',
    });
    const other = mgr.getState(T2, U1);
    expect(other).toBeNull();
  });

  it('emits change events to subscribers', () => {
    const mgr = new AIPresenceManager();
    const events: string[] = [];
    const unsub = mgr.subscribe(T1, U1, (s) => events.push(s.currentPage));
    mgr.start({
      tenantId: T1,
      userId: U1,
      portal: 'manager',
      initialPage: '/manager/properties',
    });
    mgr.updatePage(T1, U1, '/manager/maintenance');
    unsub();
    expect(events).toEqual([
      '/manager/properties',
      '/manager/maintenance',
    ]);
  });

  it('getPageContext falls back gracefully for unknown routes', () => {
    const ctx = getPageContext('/something/unknown');
    expect(ctx.pageType).toBe('other');
  });

  it('getContextualHelp returns null when user has no presence', () => {
    const mgr = new AIPresenceManager();
    expect(mgr.getContextualHelp(T1, U1)).toBeNull();
  });
});

describe('AmbientBrain: BehaviorObserver', () => {
  it('emits offer_help intervention on long idle', () => {
    const observer = new BehaviorObserver({ idleThresholdMs: 10 });
    const events: string[] = [];
    observer.subscribe((i) => events.push(i.trigger));
    const interventions = observer.record(
      baseEvent({
        type: 'idle',
        fieldId: 'security_deposit',
        fieldName: 'Security deposit',
        durationMs: 45_000,
      }),
    );
    expect(interventions).toHaveLength(1);
    expect(interventions[0].type).toBe('offer_help');
    expect(interventions[0].trigger).toBe('idle_security_deposit');
    expect(events).toEqual(['idle_security_deposit']);
  });

  it('emits explain_field after repeated errors on same field', () => {
    const observer = new BehaviorObserver();
    observer.record(baseEvent({ type: 'field_error', fieldId: 'rent' }));
    const second = observer.record(
      baseEvent({ type: 'field_error', fieldId: 'rent', fieldName: 'Monthly rent' }),
    );
    expect(second.some((i) => i.type === 'explain_field')).toBe(true);
  });

  it('field_success clears error count so the next error does not re-trigger', () => {
    const observer = new BehaviorObserver();
    observer.record(baseEvent({ type: 'field_error', fieldId: 'rent' }));
    observer.record(baseEvent({ type: 'field_success', fieldId: 'rent' }));
    const third = observer.record(
      baseEvent({ type: 'field_error', fieldId: 'rent' }),
    );
    expect(third.filter((i) => i.type === 'explain_field')).toHaveLength(0);
  });

  it('respects cooldown between identical triggers', () => {
    const observer = new BehaviorObserver({
      idleThresholdMs: 10,
      interventionCooldownMs: 60_000,
    });
    const first = observer.record(
      baseEvent({ type: 'idle', fieldId: 'x', durationMs: 45_000 }),
    );
    const second = observer.record(
      baseEvent({ type: 'idle', fieldId: 'x', durationMs: 45_000 }),
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('confirm_action fires on form submit attempt', () => {
    const observer = new BehaviorObserver();
    const res = observer.record(baseEvent({ type: 'form_submit_attempt' }));
    expect(res.some((i) => i.type === 'confirm_action')).toBe(true);
  });

  it('celebrates section completion', () => {
    const observer = new BehaviorObserver();
    const res = observer.record(
      baseEvent({ type: 'section_complete', sectionId: 'lease_terms' }),
    );
    expect(res.some((i) => i.type === 'celebrate_progress')).toBe(true);
  });

  it('cross-tenant isolation: tenantA signals never bleed into tenantB', () => {
    const observer = new BehaviorObserver();
    observer.record(baseEvent({ type: 'field_error', fieldId: 'x' }));
    observer.record(baseEvent({ type: 'field_error', fieldId: 'x' }));
    const otherTenant = observer.record({
      ...baseEvent({ type: 'field_error', fieldId: 'x' }),
      tenantId: T2,
      userId: U2,
    } as BehaviorEvent);
    // tenant B must start fresh \u2014 no intervention on first error
    expect(otherTenant.filter((i) => i.type === 'explain_field')).toHaveLength(0);
  });

  it('getAnalytics returns per-user stats', () => {
    const observer = new BehaviorObserver();
    observer.record(baseEvent({ type: 'field_error', fieldId: 'a' }));
    observer.record(baseEvent({ type: 'field_error', fieldId: 'b' }));
    const analytics = observer.getAnalytics(T1, U1);
    expect(analytics.totalEvents).toBe(2);
    expect(analytics.problematicFields.length).toBeGreaterThan(0);
  });
});

describe('AmbientBrain: ProactiveInterventionEngine', () => {
  it('respects quiet mode', () => {
    const engine = new ProactiveInterventionEngine();
    engine.setPreferences(T1, U1, { quietMode: true });
    const res = engine.deliver({
      id: 'i1',
      tenantId: T1,
      userId: U1,
      type: 'offer_help',
      trigger: 'idle_on_field',
      priority: 'medium',
      message: 'hi',
      createdAt: new Date().toISOString(),
      cooldownMs: 60_000,
    });
    expect(res).toBeNull();
  });

  it('translates to Swahili when configured', () => {
    const engine = new ProactiveInterventionEngine();
    engine.setPreferences(T1, U1, { language: 'sw' });
    const res = engine.deliver({
      id: 'i1',
      tenantId: T1,
      userId: U1,
      type: 'offer_help',
      trigger: 'idle_on_field',
      priority: 'medium',
      message: 'en msg',
      messageSwahili: 'sw msg',
      createdAt: new Date().toISOString(),
      cooldownMs: 60_000,
    });
    expect(res?.displayMessage).toBe('sw msg');
  });

  it('minimal intensity drops low-priority nudges', () => {
    const engine = new ProactiveInterventionEngine();
    engine.setPreferences(T1, U1, { intensity: 'minimal' });
    const res = engine.deliver({
      id: 'i1',
      tenantId: T1,
      userId: U1,
      type: 'celebrate_progress',
      trigger: 'section_complete',
      priority: 'low',
      message: 'nice',
      createdAt: new Date().toISOString(),
      cooldownMs: 0,
    });
    expect(res).toBeNull();
  });
});
