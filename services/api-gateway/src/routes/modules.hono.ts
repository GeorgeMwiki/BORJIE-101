/**
 * /api/v1/modules — Piece B dynamic module spawning endpoints.
 *
 *   GET  /api/v1/modules                    list modules for current tenant
 *   GET  /api/v1/modules/templates          list available templates
 *   POST /api/v1/modules/spawn              spawn from template or prompt
 *   GET  /api/v1/modules/:id/spec/preview   show generated migration
 *                                            WITHOUT applying
 *   POST /api/v1/modules/:id/apply          apply pending spec (K5 gated)
 *
 * The router is composed by the api-gateway via
 * `createModulesRouter({deps, resolveTenantId, resolveUserId})`. Tests
 * inject fake deps from `@borjie/module-orchestrator/__tests__`.
 *
 * RLS enforcement: every store call carries tenantId from the JWT and
 * NEVER from the body — defence-in-depth against IDOR.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  spawnModuleFromTemplate,
  spawnModuleFromPrompt,
  applyModuleSpec,
  type OrchestratorDeps,
} from '@borjie/module-orchestrator';
import {
  previewMigration,
  validateSpec,
  type ModuleSpec,
} from '@borjie/module-spec-engine';

export interface ModulesRouterDeps {
  readonly orchestrator: OrchestratorDeps;
  readonly resolveTenantId: (c: {
    readonly req: { readonly header: (k: string) => string | undefined };
  }) => string | null;
  readonly resolveUserId: (c: {
    readonly req: { readonly header: (k: string) => string | undefined };
  }) => string | null;
}

const SpawnFromTemplateBodySchema = z.object({
  source: z.literal('template'),
  template_slug: z.string().min(1),
  module_slug: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  title: z.string().min(1).max(128),
  title_sw: z.string().nullable().optional(),
  scoped_tool_ids: z.array(z.string()).optional(),
});

const SpawnFromPromptBodySchema = z.object({
  source: z.literal('prompt'),
  persona: z.string().min(1),
  module_slug: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  title: z.string().min(1).max(128),
  title_sw: z.string().nullable().optional(),
  scoped_tool_ids: z.array(z.string()).optional(),
  candidate_spec: z.unknown(),
});

const SpawnBodySchema = z.discriminatedUnion('source', [
  SpawnFromTemplateBodySchema,
  SpawnFromPromptBodySchema,
]);

const ApplyBodySchema = z.object({
  spec_id: z.string().min(1),
});

export function createModulesRouter(deps: ModulesRouterDeps): Hono {
  const app = new Hono();

  // ── auth helper ────────────────────────────────────────────────────
  const requireTenant = (c: any): string | Response => {
    const tenantId = deps.resolveTenantId(c);
    if (!tenantId) return c.json({ error: 'unauthorized' }, 401);
    return tenantId;
  };

  // ── GET /api/v1/modules — list tenant's modules ────────────────────
  app.get('/', async (c) => {
    const tenantId = requireTenant(c);
    if (typeof tenantId !== 'string') return tenantId;

    const rows = await deps.orchestrator.modules.listModules({ tenantId });
    return c.json({
      modules: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        title_sw: r.titleSw,
        template_id: r.templateId,
        spec_id: r.specId,
        lifecycle_state: r.lifecycleState,
        vector_namespace: r.vectorNamespace,
      })),
    });
  });

  // ── GET /api/v1/modules/templates — list available templates ───────
  app.get('/templates', async (c) => {
    // No tenant required — templates are platform-wide. But we still
    // require auth so RLS rules can enforce SELECT-only.
    const tenantId = deps.resolveTenantId(c);
    if (!tenantId) return c.json({ error: 'unauthorized' }, 401);

    const templates = await deps.orchestrator.templates.listTemplates();
    return c.json({ templates });
  });

  // ── POST /api/v1/modules/spawn ─────────────────────────────────────
  app.post('/spawn', async (c) => {
    const tenantId = requireTenant(c);
    if (typeof tenantId !== 'string') return tenantId;
    const userId = deps.resolveUserId(c);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body', message: 'JSON required' }, 400);
    }
    const parsed = SpawnBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_body',
          message: 'spawn body grammar violation',
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        400,
      );
    }

    if (parsed.data.source === 'template') {
      const r = await spawnModuleFromTemplate(
        {
          tenantId,
          templateSlug: parsed.data.template_slug,
          moduleSlug: parsed.data.module_slug,
          title: parsed.data.title,
          titleSw: parsed.data.title_sw ?? null,
          scopedToolIds: parsed.data.scoped_tool_ids ?? [],
          createdByUserId: userId,
        },
        deps.orchestrator,
      );
      if (!r.ok) {
        return c.json({ error: 'spawn_failed', errors: r.errors }, 422);
      }
      return c.json(
        {
          module_id: r.moduleId,
          spec_id: r.specId,
          migration_preview: r.migrationSql,
        },
        201,
      );
    }

    // source === 'prompt'
    const r = await spawnModuleFromPrompt(
      {
        tenantId,
        persona: parsed.data.persona,
        moduleSlug: parsed.data.module_slug,
        title: parsed.data.title,
        titleSw: parsed.data.title_sw ?? null,
        scopedToolIds: parsed.data.scoped_tool_ids ?? [],
        createdByUserId: userId,
        candidateSpec: parsed.data.candidate_spec,
      },
      deps.orchestrator,
    );
    if (!r.ok) {
      return c.json({ error: 'spec_rejected', errors: r.errors }, 422);
    }
    return c.json(
      {
        module_id: r.moduleId,
        spec_id: r.specId,
        migration_preview: r.migrationSql,
      },
      201,
    );
  });

  // ── GET /api/v1/modules/:id/spec/preview ───────────────────────────
  app.get('/:id/spec/preview', async (c) => {
    const tenantId = requireTenant(c);
    if (typeof tenantId !== 'string') return tenantId;

    const id = c.req.param('id');
    const module = await deps.orchestrator.modules.findModule({
      tenantId,
      id,
    });
    if (!module || !module.specId) {
      return c.json(
        { error: 'not_found', message: 'module or spec not found' },
        404,
      );
    }
    const spec = await deps.orchestrator.specs.findSpec({
      tenantId,
      id: module.specId,
    });
    if (!spec) {
      return c.json({ error: 'not_found', message: 'spec not found' }, 404);
    }

    // Re-derive the preview from the spec json if available; else
    // serve the stored generated_migration_sql.
    return c.json({
      module_id: module.id,
      spec_id: spec.id,
      migration_sql: spec.migrationSql,
    });
  });

  // ── POST /api/v1/modules/:id/apply ─────────────────────────────────
  app.post('/:id/apply', async (c) => {
    const tenantId = requireTenant(c);
    if (typeof tenantId !== 'string') return tenantId;
    const userId = deps.resolveUserId(c);
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const parsed = ApplyBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const r = await applyModuleSpec(
      {
        tenantId,
        moduleId: id,
        specId: parsed.data.spec_id,
        requestingUserId: userId,
      },
      deps.orchestrator,
    );
    if (!r.ok) {
      const status = r.errors.some((e) => /not found/.test(e)) ? 404 : 422;
      return c.json({ error: 'apply_failed', errors: r.errors }, status);
    }
    return c.json({
      applied_migration_filename: r.appliedMigrationFilename,
      lifecycle_state: 'LIVE',
    });
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────
// Standalone preview helper — exposed so the chat-ui's "Preview" button
// can call previewMigration directly without round-tripping through the
// orchestrator (purely deterministic, no DB).
// ─────────────────────────────────────────────────────────────────────

export function previewCandidateSpec(
  candidate: unknown,
  tenantId: string,
): {
  ok: boolean;
  migrationSql: string;
  tableCount: number;
  workflowCount: number;
  uiSectionCount: number;
  moneyFieldCount: number;
  errors: readonly string[];
} {
  const v = validateSpec(candidate);
  if (!v.ok || !v.spec) {
    return {
      ok: false,
      migrationSql: '',
      tableCount: 0,
      workflowCount: 0,
      uiSectionCount: 0,
      moneyFieldCount: 0,
      errors: v.errors,
    };
  }
  return previewMigration(v.spec, tenantId);
}
