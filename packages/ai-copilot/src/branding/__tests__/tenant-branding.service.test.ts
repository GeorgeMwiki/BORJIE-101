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
import {
  TenantBrandingService,
  InMemoryTenantBrandingRepository,
} from '../tenant-branding.store.js';

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

// O-M-23 org-settings toggles must survive the updateConfig round-trip and
// be echoed by getConfig — otherwise every toggle snaps back in the UI.
describe('TenantBrandingService — O-M-23 org-settings toggles persist', () => {
  function newService() {
    return new TenantBrandingService(new InMemoryTenantBrandingRepository());
  }

  it('persists and echoes the 4 toggle fields', async () => {
    const svc = newService();
    const cfg = await svc.updateConfig('t1', {
      multiTenant: true,
      brandLock: true,
      primaryCurrency: 'TZS',
      defaultLang: 'sw',
    });
    expect(cfg.overrides).toMatchObject({
      multiTenant: true,
      brandLock: true,
      primaryCurrency: 'TZS',
      defaultLang: 'sw',
    });
    const read = await svc.getConfig('t1');
    expect(read.overrides).toMatchObject({
      multiTenant: true,
      brandLock: true,
      primaryCurrency: 'TZS',
      defaultLang: 'sw',
    });
  });

  it('persists a legitimate `false` toggle (not dropped by truthiness)', async () => {
    const svc = newService();
    const cfg = await svc.updateConfig('t1', {
      multiTenant: false,
      brandLock: false,
      primaryCurrency: 'USD',
      defaultLang: 'en',
    });
    expect(cfg.overrides.multiTenant).toBe(false);
    expect(cfg.overrides.brandLock).toBe(false);
    expect(cfg.overrides.primaryCurrency).toBe('USD');
    expect(cfg.overrides.defaultLang).toBe('en');
  });

  it('merges toggles with persona overrides without clobbering either', async () => {
    const svc = newService();
    await svc.updateConfig('t1', { aiPersonaDisplayName: 'Mr. Smith' });
    const cfg = await svc.updateConfig('t1', {
      multiTenant: false,
      primaryCurrency: 'KES',
    });
    expect(cfg.overrides.aiPersonaDisplayName).toBe('Mr. Smith');
    expect(cfg.overrides.multiTenant).toBe(false);
    expect(cfg.overrides.primaryCurrency).toBe('KES');
  });
});
