/**
 * Persona table + role mapping tests.
 */

import { describe, it, expect } from 'vitest';
import {
  ROLES,
  PERSONAS,
  getPersona,
  mapWireRoleToRole,
  RESOURCE_KINDS,
} from '../roles.js';

describe('Roles + Personas', () => {
  it('exposes a persona for every role in the union', () => {
    for (const r of ROLES) {
      expect(PERSONAS[r]).toBeDefined();
      expect(PERSONAS[r].role).toBe(r);
    }
  });

  it('every persona has a non-empty system prompt', () => {
    for (const r of ROLES) {
      expect(PERSONAS[r].systemPrompt.length).toBeGreaterThan(20);
    }
  });

  it('tone differs across roles where expected', () => {
    expect(PERSONAS.tenant.tone).toBe('friendly');
    expect(PERSONAS['property-manager'].tone).toBe('professional');
    expect(PERSONAS.admin.tone).toBe('authoritative');
    expect(PERSONAS.prospect.tone).toBe('friendly');
  });

  it('defaultDepth differs across roles', () => {
    expect(PERSONAS.prospect.defaultDepth).toBe('brief');
    expect(PERSONAS.tenant.defaultDepth).toBe('standard');
    expect(PERSONAS.admin.defaultDepth).toBe('deep');
  });

  it('tenant cannot see owner/PM-only resources', () => {
    expect(PERSONAS.tenant.canSee).not.toContain('owned-properties');
    expect(PERSONAS.tenant.canSee).not.toContain('managed-portfolio');
    expect(PERSONAS.tenant.canSee).not.toContain('staff-notes');
    expect(PERSONAS.tenant.canSee).not.toContain('org-wide-financials');
  });

  it('owner CAN see owned-properties but not tenant-pii', () => {
    expect(PERSONAS.owner.canSee).toContain('owned-properties');
    expect(PERSONAS.owner.cannotSee).toContain('tenant-pii');
  });

  it('prospect is restricted to public-only resources', () => {
    for (const r of PERSONAS.prospect.canSee) {
      expect(r.startsWith('public')).toBe(true);
    }
  });

  it('admin sees every resource kind', () => {
    expect(PERSONAS.admin.canSee.length).toBe(RESOURCE_KINDS.length);
  });

  it('service-provider is locked to assigned-jobs + building-public-info', () => {
    expect(new Set(PERSONAS['service-provider'].canSee)).toEqual(
      new Set(['assigned-jobs', 'building-public-info']),
    );
  });

  it('getPersona returns the matching persona', () => {
    expect(getPersona('tenant').role).toBe('tenant');
    expect(getPersona('owner').role).toBe('owner');
  });

  it('maps the api-gateway UserRole strings onto the coarser Role union', () => {
    expect(mapWireRoleToRole('SUPER_ADMIN')).toBe('admin');
    expect(mapWireRoleToRole('ADMIN')).toBe('admin');
    expect(mapWireRoleToRole('SUPPORT')).toBe('admin');
    expect(mapWireRoleToRole('TENANT_ADMIN')).toBe('admin');
    expect(mapWireRoleToRole('PROPERTY_MANAGER')).toBe('property-manager');
    expect(mapWireRoleToRole('ACCOUNTANT')).toBe('estate-manager');
    expect(mapWireRoleToRole('MAINTENANCE_STAFF')).toBe('estate-manager');
    expect(mapWireRoleToRole('OWNER')).toBe('owner');
    expect(mapWireRoleToRole('RESIDENT')).toBe('tenant');
    expect(mapWireRoleToRole('NOT_A_ROLE')).toBeNull();
  });
});
