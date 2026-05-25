/**
 * Tests for the MCP prompts capability — verifies the 5 canonical
 * property-management prompts list correctly, tier/scope filtering
 * works, and `getPrompt` renders + refuses appropriately.
 */

import { describe, it, expect } from 'vitest';
import {
  BORJIE_PROMPTS,
  CANONICAL_PROMPT_NAMES,
  findPromptDefinition,
  getPrompt,
  listPrompts,
} from '../prompts.js';
import type { McpAuthContext, McpScope, McpTier } from '../types.js';

function ctx(tier: McpTier, scopes: ReadonlyArray<McpScope>): McpAuthContext {
  return Object.freeze({
    tenantId: 'tenant-1',
    principalId: 'prin-1',
    principalType: 'api-key' as const,
    tier,
    scopes,
    issuedAt: 1_700_000_000_000,
    correlationId: 'corr-1',
  });
}

const ALL_SCOPES: ReadonlyArray<McpScope> = Object.freeze([
  'read:properties',
  'read:tenants',
  'read:cases',
  'write:cases',
  'read:letters',
  'write:letters',
  'read:payments',
  'read:occupancy',
  'read:graph',
  'read:warehouse',
  'read:taxonomy',
  'read:compliance',
  'read:ai-costs',
  'execute:skills',
]);

describe('BORJIE_PROMPTS catalog', () => {
  it('ships exactly the 5 canonical property-management prompts', () => {
    expect(BORJIE_PROMPTS.length).toBe(5);
    expect(CANONICAL_PROMPT_NAMES.length).toBe(5);
    for (const name of CANONICAL_PROMPT_NAMES) {
      expect(findPromptDefinition(name)).toBeDefined();
    }
  });

  it('each prompt defines name, description, render, and tier/scope policy', () => {
    for (const p of BORJIE_PROMPTS) {
      expect(p.name).toBeTruthy();
      expect(p.description.length).toBeGreaterThan(20);
      expect(typeof p.render).toBe('function');
      expect(p.minimumTier).toBeTruthy();
      expect(Array.isArray(p.arguments)).toBe(true);
    }
  });
});

describe('listPrompts', () => {
  it('returns all 5 prompts for an enterprise caller with all scopes', () => {
    const result = listPrompts(ctx('enterprise', ALL_SCOPES));
    expect(result.prompts.length).toBe(5);
  });

  it('hides Pro-tier prompts from standard-tier caller', () => {
    const result = listPrompts(ctx('standard', ALL_SCOPES));
    const names = new Set(result.prompts.map((p) => p.name));
    expect(names.has('File-KRA-MRI')).toBe(false);
    expect(names.has('Forecast-Occupancy-30d')).toBe(false);
    expect(names.has('Reconcile-Owner-Payout')).toBe(true);
  });

  it('hides prompts the caller lacks scopes for', () => {
    // Standard caller with only read:properties — should see no
    // prompts since every prompt requires more than read:properties alone.
    const result = listPrompts(ctx('standard', ['read:properties']));
    expect(result.prompts.length).toBe(0);
  });
});

describe('getPrompt — happy path', () => {
  it('renders Reconcile-Owner-Payout with arguments', () => {
    const outcome = getPrompt(
      'Reconcile-Owner-Payout',
      { propertyId: 'prop-99', period: '2026-05' },
      ctx('enterprise', ALL_SCOPES),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.messages.length).toBe(2);
      const userText = outcome.result.messages[1]!.content.text;
      expect(userText).toContain('prop-99');
      expect(userText).toContain('2026-05');
    }
  });

  it('renders Triage-Tenant-Arrears with optional asOfDate fallback', () => {
    const outcome = getPrompt(
      'Triage-Tenant-Arrears',
      { tenantProfileId: 'tp-1' },
      ctx('standard', ['read:tenants', 'read:payments', 'write:letters']),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.messages[1]!.content.text).toContain('tp-1');
      expect(outcome.result.messages[1]!.content.text).toContain('today');
    }
  });

  it('renders File-KRA-MRI for a pro-tier caller', () => {
    const outcome = getPrompt(
      'File-KRA-MRI',
      { period: '2026-05' },
      ctx('pro', ['read:payments', 'read:properties', 'read:compliance']),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.messages[0]!.content.text).toContain('KRA MRI');
    }
  });

  it('renders Schedule-Move-Out-Inspection', () => {
    const outcome = getPrompt(
      'Schedule-Move-Out-Inspection',
      { unitId: 'u-1', targetDate: '2026-06-30' },
      ctx('standard', ['read:cases', 'write:cases', 'read:occupancy']),
    );
    expect(outcome.ok).toBe(true);
  });

  it('renders Forecast-Occupancy-30d for a pro-tier caller', () => {
    const outcome = getPrompt(
      'Forecast-Occupancy-30d',
      {},
      ctx('pro', ['read:occupancy', 'read:graph']),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.messages[1]!.content.text).toContain('30-day');
    }
  });
});

describe('getPrompt — refusal paths', () => {
  it('refuses unknown prompt', () => {
    const outcome = getPrompt('Ghost-Prompt', {}, ctx('enterprise', ALL_SCOPES));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorCode).toBe('PROMPT_NOT_FOUND');
  });

  it('refuses tier-locked prompt', () => {
    const outcome = getPrompt(
      'File-KRA-MRI',
      { period: '2026-05' },
      ctx('standard', ALL_SCOPES),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorCode).toBe('TIER_INSUFFICIENT');
  });

  it('refuses scope-locked prompt', () => {
    const outcome = getPrompt(
      'Triage-Tenant-Arrears',
      { tenantProfileId: 'tp-1' },
      ctx('standard', ['read:properties']),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorCode).toBe('SCOPE_INSUFFICIENT');
  });

  it('refuses when a required argument is missing', () => {
    const outcome = getPrompt(
      'Reconcile-Owner-Payout',
      { propertyId: 'prop-1' }, // missing period
      ctx('enterprise', ALL_SCOPES),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorCode).toBe('ARGUMENT_MISSING');
  });

  it('refuses when a required argument is empty whitespace', () => {
    const outcome = getPrompt(
      'Schedule-Move-Out-Inspection',
      { unitId: '   ', targetDate: '2026-06-30' },
      ctx('standard', ['read:cases', 'write:cases', 'read:occupancy']),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorCode).toBe('ARGUMENT_MISSING');
  });
});
