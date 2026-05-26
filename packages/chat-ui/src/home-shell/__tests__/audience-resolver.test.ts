/**
 * audience-resolver — persona routing tests.
 *
 * Mirrors HOME_DASHBOARD_STANDARD §3 — every row in the persona
 * routing table must be pinned.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultSurfaceForRole,
  resolveAudience,
} from '../resolve/audience-resolver.js';

describe('resolveAudience', () => {
  it('routes owner -> Mr. Mwikila (full MD)', () => {
    const agent = resolveAudience({ user_role: 'owner', surface: 'owner-web' });
    expect(agent.display_name).toBe('Mr. Mwikila');
    expect(agent.title).toBe('Managing Director');
    expect(agent.id).toBe('mr-mwikila-full');
  });

  it('routes admin -> Mr. Mwikila (full MD)', () => {
    const agent = resolveAudience({ user_role: 'admin', surface: 'admin-web' });
    expect(agent.display_name).toBe('Mr. Mwikila');
    expect(agent.id).toBe('mr-mwikila-full');
  });

  it('routes public -> Mr. Mwikila (public mode)', () => {
    const agent = resolveAudience({
      user_role: 'public',
      surface: 'marketing',
    });
    expect(agent.display_name).toBe('Mr. Mwikila');
    expect(agent.id).toBe('mr-mwikila-public');
  });

  it('routes worker -> safety/comms/shift junior', () => {
    const agent = resolveAudience({
      user_role: 'worker',
      surface: 'workforce-mobile',
    });
    expect(agent.id).toBe('safety-junior');
    expect(agent.title).toBe('Workforce Junior');
  });

  it('routes buyer -> marketplace junior', () => {
    const agent = resolveAudience({
      user_role: 'buyer',
      surface: 'buyer-mobile',
    });
    expect(agent.id).toBe('marketplace-junior');
  });

  it('routes site_manager on workforce-mobile -> Mr. Mwikila (cross-domain)', () => {
    const agent = resolveAudience({
      user_role: 'site_manager',
      surface: 'workforce-mobile',
    });
    expect(agent.id).toBe('mr-mwikila-full');
  });

  it('routes site_manager on bossnyumba-estate -> estate-ops junior', () => {
    const agent = resolveAudience({
      user_role: 'site_manager',
      surface: 'bossnyumba-estate-manager-app',
    });
    expect(agent.id).toBe('estate-ops-junior');
  });

  it('honours persona_override deep-link', () => {
    const agent = resolveAudience({
      user_role: 'owner',
      surface: 'owner-web',
      persona_override: 'finance-mode',
    });
    expect(agent.id).toBe('finance-mode');
  });

  it('preserves surface in the resolved agent', () => {
    const agent = resolveAudience({
      user_role: 'owner',
      surface: 'bossnyumba-owner-portal',
    });
    expect(agent.surface).toBe('bossnyumba-owner-portal');
  });
});

describe('defaultSurfaceForRole', () => {
  it.each([
    ['owner', 'owner-web'],
    ['admin', 'admin-web'],
    ['public', 'marketing'],
    ['worker', 'workforce-mobile'],
    ['site_manager', 'workforce-mobile'],
    ['buyer', 'buyer-mobile'],
  ] as const)('%s -> %s', (role, expected) => {
    expect(defaultSurfaceForRole(role)).toBe(expected);
  });
});
