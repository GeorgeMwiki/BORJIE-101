// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * /api/v1/brain/migration — Migration Wizard routes.
 *
 *   POST /upload              — accept a file, create MigrationRun, stage
 *                               bundle via skill.migration.extract
 *   POST /:runId/commit       — execute the approved run (amplified commit)
 *   POST /:runId/ask          — forward a chat turn to the copilot
 *
 * Transport only — business logic lives in MigrationService and the
 * ai-copilot skills. Auth enforcement follows the same pattern as
 * brain.hono.ts (verified Supabase JWT, tenant claim required).
 */

import { Hono } from 'hono';
import {
  migrationExtract,
  MigrationExtractParamsSchema,
  ProgressiveIntelligence,
} from '@borjie/ai-copilot';
import {
  MigrationService,
  PostgresMigrationRepository,
} from '@borjie/domain-services';
import { parseUpload } from '@borjie/ai-copilot/services/migration/parsers/parse-upload';

import { withSecurityEvents } from '@borjie/observability';
// Singleton per-process accumulator — session scoping handled per-run.
// In production, swap for a persistent repository backed by
// `progressive_context_snapshots` (migration 0042).
const progressiveAccumulator =
  ProgressiveIntelligence.createContextAccumulator();
const progressiveAutoGen =
  ProgressiveIntelligence.createAutoGenerationService(progressiveAccumulator);

type Bindings = Record<string, never>;
type Variables = {
  tenantId: string;
  actorId: string;
};

export function createMigrationRouter(deps: {
  getService: (tenantId: string) => MigrationService;
  authMiddleware?: (c: any, next: () => Promise<void>) => Promise<Response | void>;
}) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  if (deps.authMiddleware) {
    app.use('*', deps.authMiddleware);
  }

  // ----------------------- POST /upload -----------------------
  app.post('/upload', withSecurityEvents({ action: 'migration.create', resource: 'migration', severity: 'info' }, async (c) => {
    const tenantId = c.get('tenantId');
    const actorId = c.get('actorId');
    if (!tenantId || !actorId) return c.json({ error: 'unauthenticated' }, 401);

    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    if (!file) return c.json({ error: 'missing file' }, 400);

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await parseUpload(buf, file.type, { filename: file.name });

    const extractParams = MigrationExtractParamsSchema.parse({
      sheets: parsed.sheets,
      plainText: parsed.plainText,
    });
    const bundle = migrationExtract(extractParams);

    const service = deps.getService(tenantId);
    const run = await service['repo']
      // @ts-expect-error reaching into repo for createRun is intentional
      .createRun({
        tenantId,
        createdBy: actorId,
        uploadFilename: file.name,
        uploadMimeType: file.type,
        uploadSizeBytes: buf.byteLength,
      });

    // @ts-expect-error same rationale
    await service['repo'].updateStatus(run.id, tenantId, 'extracted', {
      bundle,
      extractionSummary: {
        properties: bundle.properties.length,
        units: bundle.units.length,
        tenants: bundle.tenants.length,
        employees: bundle.employees.length,
        departments: bundle.departments.length,
        teams: bundle.teams.length,
      },
    });

    // Progressive-intelligence preview: feed the extracted bundle rows into
    // the accumulator so the UI can render a "what we understood" pane
    // that fills in as the operator chats.
    let progressivePreview: unknown = null;
    try {
      const rows = [
        ...bundle.tenants.map((t: Record<string, unknown>, idx: number) => ({
          rowIndex: idx,
          data: t,
        })),
        ...bundle.units.map((u: Record<string, unknown>, idx: number) => ({
          rowIndex: bundle.tenants.length + idx,
          data: u,
        })),
      ];
      progressivePreview = await progressiveAutoGen.buildPreview({
        tenantId,
        sessionId: `migration-${run.id}`,
        sourceSystem: 'lpms-upload',
        sourceFile: file.name,
        rows,
      });
    } catch {
      progressivePreview = null;
    }

    return c.json({
      runId: run.id,
      bundle,
      warnings: parsed.warnings,
      progressivePreview,
    });
  }));

  // ----------------------- POST /:runId/commit -----------------------
  app.post('/:runId/commit', withSecurityEvents({ action: 'migration.create', resource: 'migration', severity: 'info' }, async (c) => {
    const tenantId = c.get('tenantId');
    const actorId = c.get('actorId');
    if (!tenantId || !actorId) return c.json({ error: 'unauthenticated' }, 401);

    const runId = c.req.param('runId');
    const service = deps.getService(tenantId);
    const result = await service.commit({ tenantId, runId, actorId });

    if (!result.ok) {
      return c.json(
        { ok: false, error: result.error },
        result.error.code === 'RUN_NOT_FOUND' ? 404 : 409
      );
    }
    return c.json({
      ok: true,
      runId,
      counts: result.counts,
      skipped: result.skipped,
    });
  }));

  // ----------------------- POST /:runId/ask -----------------------
  // Copilot turn: the client posts the admin's chat message; we forward
  // it to the MigrationWizardCopilot (wired via the BrainRegistry in
  // brain.hono.ts). The handler here is a thin proxy.
  app.post('/:runId/ask', withSecurityEvents({ action: 'migration.create', resource: 'migration', severity: 'info' }, async (c) => {
    const tenantId = c.get('tenantId');
    const actorId = c.get('actorId');
    if (!tenantId || !actorId) return c.json({ error: 'unauthenticated' }, 401);

    const runId = c.req.param('runId');
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!body.message) return c.json({ error: 'missing message' }, 400);

    // KI-013 — when a MigrationWizardCopilot is bound on the deps, use
    // it. Otherwise: loud-failure 501 unless a per-tenant feature flag
    // is on (dev mode). The previous silent ack hid the gap from
    // observability dashboards.
    const wizard = (deps as { migrationWizardCopilot?: { run(args: { tenantId: string; actorId: string; runId: string; message: string }): Promise<unknown> } })
      .migrationWizardCopilot;
    if (wizard && typeof wizard.run === 'function') {
      try {
        const out = await wizard.run({ tenantId, actorId, runId, message: body.message });
        return c.json({ ok: true, runId, data: out });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'copilot failed';
        return c.json(
          { ok: false, error: { code: 'COPILOT_ERROR', message } },
          503,
        );
      }
    }

    const services = (c.get('services') as { featureFlags?: { isEnabled(t: string, k: string): Promise<boolean> } } | undefined) ?? {};
    const flagKey = 'flag.bff.migration.copilot_ask';
    let flagOn = false;
    try {
      flagOn = Boolean(await services.featureFlags?.isEnabled(tenantId, flagKey));
    } catch {
      flagOn = false;
    }
    if (!flagOn) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message:
              'Migration-wizard copilot is not wired. Concrete next-step: add MigrationWizardCopilot to ServiceRegistry and pass it to createMigrationRouter via deps.migrationWizardCopilot. See Docs/KNOWN_ISSUES.md#ki-013.',
            flagKey,
          },
        },
        501,
      );
    }
    return c.json({
      runId,
      ack: true,
      note: 'copilot proxy scaffolded — flag-gated dev response while BrainRegistry wiring is pending',
    });
  }));

  return app;
}
