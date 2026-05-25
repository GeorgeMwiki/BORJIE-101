/**
 * Built-in seeds for personas + titles.
 *
 * Generic on purpose — no jurisdiction (TRC, BoT, hotel-chain, etc.)
 * strings. Tenants relabel via the `titles` table; the brain still
 * routes by tier.
 *
 * Seven built-in personas:
 *
 *   - T1_owner_strategist        — tier 1, all-tenant scope
 *   - T2_admin_strategist        — tier 2, all-tenant scope
 *   - T3_module_manager          — tier 3, module-scope
 *   - T4_field_employee          — tier 4, module-scope, own actions
 *   - T5_customer_concierge      — tier 5, own-records
 *   - T_auditor                  — cross-cutting read-only (no tools)
 *   - T_vendor                   — external vendor, own-records
 *
 * Five built-in titles (one per tier).
 *
 * Both lists carry `is_built_in = true` so the seed helper is
 * idempotent — re-running it skips rows already present.
 */

import type {
  Persona,
  PersonaBinding,
  PowerTier,
  ScopePredicate,
  Title,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Built-in titles
// ─────────────────────────────────────────────────────────────────────

export interface BuiltInTitleSpec {
  readonly slug: string;
  readonly displayNameEn: string;
  readonly displayNameSw: string;
  readonly powerTier: PowerTier;
  readonly icon: string;
}

export const BUILT_IN_TITLES: ReadonlyArray<BuiltInTitleSpec> = Object.freeze([
  {
    slug: 'owner',
    displayNameEn: 'Owner',
    displayNameSw: 'Mwenye',
    powerTier: 1,
    icon: 'crown',
  },
  {
    slug: 'admin',
    displayNameEn: 'Administrator',
    displayNameSw: 'Msimamizi',
    powerTier: 2,
    icon: 'shield',
  },
  {
    slug: 'manager',
    displayNameEn: 'Manager',
    displayNameSw: 'Meneja',
    powerTier: 3,
    icon: 'briefcase',
  },
  {
    slug: 'employee',
    displayNameEn: 'Employee',
    displayNameSw: 'Mfanyakazi',
    powerTier: 4,
    icon: 'user',
  },
  {
    slug: 'customer',
    displayNameEn: 'Customer',
    displayNameSw: 'Mteja',
    powerTier: 5,
    icon: 'user-round',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Built-in personas
// ─────────────────────────────────────────────────────────────────────

export interface BuiltInPersonaSpec {
  readonly slug: string;
  readonly displayNameEn: string;
  readonly displayNameSw: string;
  readonly powerTier: PowerTier;
  readonly scopePredicate: ScopePredicate;
  readonly toolCatalogIds: ReadonlyArray<string>;
  readonly channelAllowlist: ReadonlyArray<'web' | 'mobile' | 'whatsapp' | 'sms' | 'voice'>;
  readonly maxActionTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'SOVEREIGN';
  readonly memoryNamespaceTemplate: string;
  readonly uiSectionFilter: ReadonlyArray<string>;
}

export const BUILT_IN_PERSONAS: ReadonlyArray<BuiltInPersonaSpec> =
  Object.freeze([
    {
      slug: 'T1_owner_strategist',
      displayNameEn: 'Owner Strategist',
      displayNameSw: 'Mkakati wa Mwenye',
      powerTier: 1,
      scopePredicate: { kind: 'tenant_scope' },
      toolCatalogIds: [
        'tenant.read',
        'org.manage',
        'billing.read',
        'billing.write',
        'persona.bind',
        'autonomy.policy',
        'audit.read',
      ],
      channelAllowlist: ['web', 'mobile'],
      maxActionTier: 'SOVEREIGN',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T2_admin_strategist',
      displayNameEn: 'Admin Strategist',
      displayNameSw: 'Mkakati wa Msimamizi',
      powerTier: 2,
      scopePredicate: { kind: 'tenant_scope' },
      toolCatalogIds: [
        'tenant.read',
        'org.read',
        'user.invite',
        'user.suspend',
        'autonomy.policy',
        'audit.read',
        'reports.read',
      ],
      channelAllowlist: ['web', 'mobile'],
      maxActionTier: 'HIGH',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T3_module_manager',
      displayNameEn: 'Module Manager',
      displayNameSw: 'Meneja wa Idara',
      powerTier: 3,
      scopePredicate: { kind: 'module_scope' },
      toolCatalogIds: [
        'module.read',
        'module.write',
        'reports.read',
        'workflow.execute',
      ],
      channelAllowlist: ['web', 'mobile'],
      maxActionTier: 'MEDIUM',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:module:{module_id}:project:{project_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T4_field_employee',
      displayNameEn: 'Field Employee',
      displayNameSw: 'Mfanyakazi wa Mashinani',
      powerTier: 4,
      scopePredicate: { kind: 'module_scope' },
      toolCatalogIds: [
        'module.read',
        'records.create',
        'records.update.own',
      ],
      channelAllowlist: ['web', 'mobile'],
      maxActionTier: 'LOW',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:module:{module_id}:user:{user_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T5_customer_concierge',
      displayNameEn: 'Customer Concierge',
      displayNameSw: 'Msaidizi wa Mteja',
      powerTier: 5,
      scopePredicate: { kind: 'own_records' },
      toolCatalogIds: [
        'records.read.own',
        'records.create.own',
        'records.update.own',
      ],
      channelAllowlist: ['web', 'mobile', 'whatsapp', 'sms'],
      maxActionTier: 'LOW',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:user:{user_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T_auditor',
      displayNameEn: 'Auditor',
      displayNameSw: 'Mkaguzi',
      powerTier: 2,
      scopePredicate: { kind: 'tenant_scope' },
      toolCatalogIds: ['audit.read', 'reports.read'],
      channelAllowlist: ['web'],
      maxActionTier: 'LOW',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}',
      uiSectionFilter: [],
    },
    {
      slug: 'T_vendor',
      displayNameEn: 'Vendor',
      displayNameSw: 'Muuzaji',
      powerTier: 5,
      scopePredicate: { kind: 'own_records' },
      toolCatalogIds: [
        'records.read.own',
        'records.create.own',
        'work_order.update.own',
      ],
      channelAllowlist: ['web', 'mobile', 'whatsapp'],
      maxActionTier: 'LOW',
      memoryNamespaceTemplate:
        'tenant:{tenant_id}:persona:{persona_slug}:user:{user_id}',
      uiSectionFilter: [],
    },
  ]);

// ─────────────────────────────────────────────────────────────────────
// Seed port — caller-provided I/O so this module is unit-testable.
// ─────────────────────────────────────────────────────────────────────

export interface SeedPort {
  existingTitleSlugs(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<string>>;
  existingPersonaSlugs(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<string>>;
  insertTitles(args: {
    readonly tenantId: string;
    readonly rows: ReadonlyArray<Title>;
  }): Promise<void>;
  insertPersonas(args: {
    readonly tenantId: string;
    readonly rows: ReadonlyArray<Persona>;
  }): Promise<void>;
  generateId(args: {
    readonly kind: 'title' | 'persona' | 'binding' | 'memory_namespace';
  }): string;
}

export interface SeedResult {
  readonly titlesInserted: ReadonlyArray<string>;
  readonly personasInserted: ReadonlyArray<string>;
}

/**
 * Seed built-in titles + personas for a tenant. Idempotent — checks the
 * current slugs in the DB and only inserts the ones that are missing.
 */
export async function seedBuiltInTitlesAndPersonas(args: {
  readonly tenantId: string;
  readonly port: SeedPort;
}): Promise<SeedResult> {
  const [existingTitleSlugs, existingPersonaSlugs] = await Promise.all([
    args.port.existingTitleSlugs({ tenantId: args.tenantId }),
    args.port.existingPersonaSlugs({ tenantId: args.tenantId }),
  ]);

  const titleSlugSet = new Set(existingTitleSlugs);
  const personaSlugSet = new Set(existingPersonaSlugs);

  const titlesToInsert: Title[] = BUILT_IN_TITLES.filter(
    (t) => !titleSlugSet.has(t.slug),
  ).map((t) => ({
    id: args.port.generateId({ kind: 'title' }),
    tenantId: args.tenantId,
    slug: t.slug,
    displayNameEn: t.displayNameEn,
    displayNameSw: t.displayNameSw,
    powerTier: t.powerTier,
    isBuiltIn: true,
    icon: t.icon,
  }));

  const personasToInsert: Persona[] = BUILT_IN_PERSONAS.filter(
    (p) => !personaSlugSet.has(p.slug),
  ).map((p) => ({
    id: args.port.generateId({ kind: 'persona' }),
    tenantId: args.tenantId,
    slug: p.slug,
    displayNameEn: p.displayNameEn,
    displayNameSw: p.displayNameSw,
    powerTier: p.powerTier,
    scopePredicate: p.scopePredicate,
    toolCatalogIds: [...p.toolCatalogIds],
    channelAllowlist: [...p.channelAllowlist],
    maxActionTier: p.maxActionTier,
    memoryNamespaceTemplate: p.memoryNamespaceTemplate,
    uiSectionFilter: [...p.uiSectionFilter],
    isBuiltIn: true,
  }));

  if (titlesToInsert.length > 0) {
    await args.port.insertTitles({
      tenantId: args.tenantId,
      rows: titlesToInsert,
    });
  }
  if (personasToInsert.length > 0) {
    await args.port.insertPersonas({
      tenantId: args.tenantId,
      rows: personasToInsert,
    });
  }

  return {
    titlesInserted: Object.freeze(titlesToInsert.map((t) => t.slug)),
    personasInserted: Object.freeze(personasToInsert.map((p) => p.slug)),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Memory namespace key renderer
// ─────────────────────────────────────────────────────────────────────

export interface RenderTemplateArgs {
  readonly template: string;
  readonly tokens: Readonly<{
    tenant_id?: string;
    persona_slug?: string;
    project_id?: string;
    module_id?: string;
    user_id?: string;
  }>;
}

/**
 * Render a memory_namespace_template into a concrete key. Unset tokens
 * collapse to the literal `nil` so the rendered key is stable even when
 * an optional dimension is missing.
 */
export function renderMemoryNamespaceKey(args: RenderTemplateArgs): string {
  return args.template
    .replace(/\{tenant_id\}/g, args.tokens.tenant_id ?? 'nil')
    .replace(/\{persona_slug\}/g, args.tokens.persona_slug ?? 'nil')
    .replace(/\{project_id\}/g, args.tokens.project_id ?? 'nil')
    .replace(/\{module_id\}/g, args.tokens.module_id ?? 'nil')
    .replace(/\{user_id\}/g, args.tokens.user_id ?? 'nil');
}

// ─────────────────────────────────────────────────────────────────────
// Re-export PersonaBinding type for convenience (consumers of seeds
// almost always build bindings next).
// ─────────────────────────────────────────────────────────────────────

export type { PersonaBinding };
