import { describe, expect, it } from 'vitest';
import { buildComposeAuditPayload } from '../audit/audit-chain-link.js';

describe('buildComposeAuditPayload', () => {
  it('returns the canonical kind tag', () => {
    const p = buildComposeAuditPayload({
      function_id: 'f',
      manifest_version: 1,
      function_input_hash: 'in',
      function_output_hash: 'out',
      user_context_hash: 'ctx',
      generated_recipe_hash: 'rh',
      composer_version: 'c-1',
      user_id: 'u',
      session_id: 's',
      tenant_id: 't',
      scope_kind: 'site',
      scope_id: 'sx',
      timestamp_iso: '2026-05-26T00:00:00Z',
    });
    expect(p.kind).toBe('ephemeral_dashboard_compose');
    expect(p.payload.function_id).toBe('f');
    expect(p.payload.generated_recipe_hash).toBe('rh');
  });

  it('returns a frozen payload', () => {
    const p = buildComposeAuditPayload({
      function_id: 'f',
      manifest_version: 1,
      function_input_hash: 'in',
      function_output_hash: 'out',
      user_context_hash: 'ctx',
      generated_recipe_hash: 'rh',
      composer_version: 'c-1',
      user_id: 'u',
      session_id: 's',
      tenant_id: 't',
      scope_kind: 'site',
      scope_id: 'sx',
      timestamp_iso: '2026-05-26T00:00:00Z',
    });
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.payload)).toBe(true);
  });
});
