/**
 * TenantBrandingService tests — pins Wave 27 Agent E (Part A)
 * priority 3. Default resolves to 'Borjie AI'; tenant overrides
 * apply; Kenya-pilot deploys can opt into 'Mr. Mwikila' via config.
 */

import { describe, it, expect } from 'vitest';
import {
  aiPersonaDisplayName,
  aiPersonaFullName,
  aiGreeting,
  aiPronoun,
  renderBrandedTemplate,
  DEFAULT_AI_PERSONA_DISPLAY_NAME,
  MR_MWIKILA_ALIAS,
  type BrandingCapableTenant,
} from '../tenant-branding.service.js';

describe('TenantBrandingService — defaults', () => {
  it('returns country-neutral default when branding is absent', () => {
    const tenant: BrandingCapableTenant = { id: 't1' };
    expect(aiPersonaDisplayName(tenant)).toBe(DEFAULT_AI_PERSONA_DISPLAY_NAME);
    expect(aiPersonaDisplayName(tenant)).toBe('Borjie AI');
  });

  it('returns default for null/undefined tenant', () => {
    expect(aiPersonaDisplayName(null)).toBe('Borjie AI');
    expect(aiPersonaDisplayName(undefined)).toBe('Borjie AI');
  });

  it('never returns Mr. Mwikila unless the tenant asked for it', () => {
    const tenant: BrandingCapableTenant = { id: 't1', countryCode: 'KE' };
    expect(aiPersonaDisplayName(tenant)).not.toBe('Mr. Mwikila');
  });

  it('default pronoun is neutral "they"', () => {
    expect(aiPronoun({ id: 't1' })).toBe('they');
  });

  it('default greeting is "Welcome", not Karibu', () => {
    expect(aiGreeting({ id: 't1' })).toBe('Welcome');
  });
});

describe('TenantBrandingService — tenant overrides', () => {
  it('honours configured display name', () => {
    const tenant: BrandingCapableTenant = {
      id: 't-london',
      countryCode: 'GB',
      branding: { aiPersonaDisplayName: 'Mr. Smith' },
    };
    expect(aiPersonaDisplayName(tenant)).toBe('Mr. Smith');
  });

  it('Kenya-pilot tenants can opt into the Mr. Mwikila alias', () => {
    const tenant: BrandingCapableTenant = {
      id: 't-ke-pilot',
      countryCode: 'KE',
      branding: { aiPersonaDisplayName: MR_MWIKILA_ALIAS },
    };
    expect(aiPersonaDisplayName(tenant)).toBe('Mr. Mwikila');
  });

  it('full name combines honorific + display name', () => {
    const tenant: BrandingCapableTenant = {
      id: 't-seoul',
      countryCode: 'KR',
      branding: { aiPersonaDisplayName: 'Kim', aiPersonaHonorific: 'Professor' },
    };
    expect(aiPersonaFullName(tenant)).toBe('Professor Kim');
  });

  it('honors custom greeting per locale', () => {
    const tenant: BrandingCapableTenant = {
      id: 't-de',
      countryCode: 'DE',
      branding: { aiGreeting: 'Willkommen' },
    };
    expect(aiGreeting(tenant)).toBe('Willkommen');
  });

  it('trims whitespace on override strings', () => {
    const tenant: BrandingCapableTenant = {
      id: 't',
      branding: { aiPersonaDisplayName: '   ' },
    };
    expect(aiPersonaDisplayName(tenant)).toBe('Borjie AI');
  });
});

describe('TenantBrandingService — template rendering', () => {
  it('replaces {{ai_persona_display_name}}', () => {
    const tenant: BrandingCapableTenant = {
      id: 't1',
      branding: { aiPersonaDisplayName: 'Mr. Smith' },
    };
    const out = renderBrandedTemplate(
      'Hello, I am {{ai_persona_display_name}}.',
      tenant,
    );
    expect(out).toBe('Hello, I am Mr. Smith.');
  });

  it('replaces {{ai_greeting}} and {{ai_pronoun}}', () => {
    const tenant: BrandingCapableTenant = {
      id: 't1',
      branding: {
        aiGreeting: 'Willkommen',
        aiPronoun: 'she',
        aiPersonaDisplayName: 'Anna',
      },
    };
    const out = renderBrandedTemplate(
      '{{ai_greeting}}! I am {{ai_persona_display_name}} and {{ai_pronoun}} will help.',
      tenant,
    );
    expect(out).toBe('Willkommen! I am Anna and she will help.');
  });

  it('leaves unknown template tokens untouched', () => {
    const out = renderBrandedTemplate('Hello {{unknown_token}}', { id: 't1' });
    expect(out).toBe('Hello {{unknown_token}}');
  });
});
