/**
 * TenantBrandingService — stateful wrapper around the pure branding
 * helpers in `tenant-branding.service.ts`. Keeps a per-tenant overrides
 * map behind an `InMemoryTenantBrandingRepository` so the api-gateway
 * can expose GET/PUT/reset endpoints without requiring a Postgres
 * migration in Wave 27. Repository is swappable — a Postgres-backed
 * implementation can land later by matching the narrow interface.
 *
 * Design notes:
 *   - Pure resolvers (aiPersonaDisplayName, aiGreeting, etc.) still
 *     live in tenant-branding.service.ts; this class is only an
 *     orchestration layer for read/write/delete of overrides.
 *   - All returned objects are fresh copies (immutability rule).
 */
import {
  aiPersonaDisplayName,
  aiPersonaFullName,
  aiGreeting,
  aiPronoun,
  DEFAULT_AI_PERSONA_DISPLAY_NAME,
  DEFAULT_AI_GREETING,
  DEFAULT_AI_PRONOUN,
  type TenantBrandingOverrides,
} from './tenant-branding.service.js';

export interface TenantBrandingRepository {
  get(tenantId: string): Promise<TenantBrandingOverrides | null>;
  set(tenantId: string, overrides: TenantBrandingOverrides): Promise<void>;
  reset(tenantId: string): Promise<void>;
}

/**
 * In-memory repository — used in degraded mode and tests. Never
 * persists across restarts; Postgres-backed impl can replace this at
 * composition time.
 */
export class InMemoryTenantBrandingRepository implements TenantBrandingRepository {
  private readonly store = new Map<string, TenantBrandingOverrides>();

  async get(tenantId: string): Promise<TenantBrandingOverrides | null> {
    const found = this.store.get(tenantId);
    return found ? { ...found } : null;
  }

  async set(tenantId: string, overrides: TenantBrandingOverrides): Promise<void> {
    this.store.set(tenantId, { ...overrides });
  }

  async reset(tenantId: string): Promise<void> {
    this.store.delete(tenantId);
  }
}

export interface TenantBrandingConfig {
  readonly tenantId: string;
  readonly overrides: TenantBrandingOverrides;
  /** Fully-resolved effective values (with defaults applied). */
  readonly resolved: {
    readonly aiPersonaDisplayName: string;
    readonly aiPersonaFullName: string;
    readonly aiGreeting: string;
    readonly aiPronoun: 'he' | 'she' | 'they';
  };
}

export class TenantBrandingService {
  constructor(private readonly repository: TenantBrandingRepository) {}

  async getConfig(tenantId: string): Promise<TenantBrandingConfig> {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    const stored = (await this.repository.get(tenantId)) ?? {};
    const tenant = { id: tenantId, branding: stored };
    return {
      tenantId,
      overrides: { ...stored },
      resolved: {
        aiPersonaDisplayName: aiPersonaDisplayName(tenant),
        aiPersonaFullName: aiPersonaFullName(tenant),
        aiGreeting: aiGreeting(tenant),
        aiPronoun: aiPronoun(tenant),
      },
    };
  }

  async updateConfig(
    tenantId: string,
    overrides: TenantBrandingOverrides,
  ): Promise<TenantBrandingConfig> {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    // Merge with existing; drop empty strings so they don't shadow defaults.
    const current = (await this.repository.get(tenantId)) ?? {};
    const merged: TenantBrandingOverrides = {
      ...current,
      ...overrides,
    };
    // Trim strings; remove keys that were explicitly blanked. Build the
    // clean object immutably via spread to honour the `readonly` shape
    // of TenantBrandingOverrides.
    const displayName =
      typeof merged.aiPersonaDisplayName === 'string' && merged.aiPersonaDisplayName.trim()
        ? merged.aiPersonaDisplayName.trim()
        : undefined;
    const honorific =
      typeof merged.aiPersonaHonorific === 'string' && merged.aiPersonaHonorific.trim()
        ? merged.aiPersonaHonorific.trim()
        : undefined;
    const greeting =
      typeof merged.aiGreeting === 'string' && merged.aiGreeting.trim()
        ? merged.aiGreeting.trim()
        : undefined;
    const pronoun = merged.aiPronoun ?? undefined;
    const clean: TenantBrandingOverrides = {
      ...(displayName ? { aiPersonaDisplayName: displayName } : {}),
      ...(honorific ? { aiPersonaHonorific: honorific } : {}),
      ...(greeting ? { aiGreeting: greeting } : {}),
      ...(pronoun ? { aiPronoun: pronoun } : {}),
    };
    await this.repository.set(tenantId, clean);
    return this.getConfig(tenantId);
  }

  async resetConfig(tenantId: string): Promise<TenantBrandingConfig> {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    await this.repository.reset(tenantId);
    return this.getConfig(tenantId);
  }

  /** Expose the defaults for clients that want a shape before customising. */
  getDefaults(): TenantBrandingConfig['resolved'] {
    return {
      aiPersonaDisplayName: DEFAULT_AI_PERSONA_DISPLAY_NAME,
      aiPersonaFullName: DEFAULT_AI_PERSONA_DISPLAY_NAME,
      aiGreeting: DEFAULT_AI_GREETING,
      aiPronoun: DEFAULT_AI_PRONOUN,
    };
  }
}
