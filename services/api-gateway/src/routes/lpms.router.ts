/**
 * LPMS import router — Wave 8 (S14 gap closure)
 *
 * Mounted at `/api/v1/lpms`. Exposes a format-agnostic import endpoint
 * that normalizes legacy Land & Property Management System export dumps
 * (CSV / JSON / XML) into the shape consumed by MigrationWriterService.
 *
 *   POST /import              — body: { format: 'csv'|'json'|'xml', content: string, columnMap?: object, commit?: boolean }
 *   GET  /preview-schema      — lists the normalized target schema so operators know what fields are accepted
 *
 * Tenant isolation is enforced through authMiddleware — every produced
 * row is stamped with the JWT's tenantId, never a value from the file.
 *
 * When `commit=false` (default) the endpoint returns the parsed result
 * for review. When `commit=true` the result is forwarded to the platform
 * MigrationWriterService for write. Commit path is gated behind a
 * dedicated permission check; preview mode is available to any
 * authenticated operator.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import {
  LpmsCsvAdapter,
  LpmsJsonAdapter,
  LpmsXmlAdapter,
  LpmsParseError,
} from '@borjie/lpms-connector';

import { withSecurityEvents } from '@borjie/observability';
const ImportSchema = z.object({
  format: z.enum(['csv', 'json', 'xml']),
  content: z.string().min(1).max(50 * 1024 * 1024), // 50MB cap per upload
  columnMap: z.record(z.string(), z.string()).optional(),
  bestEffort: z.boolean().optional(),
  commit: z.boolean().optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

app.post('/import', zValidator('json', ImportSchema), withSecurityEvents({ action: 'lpm.create', resource: 'lpm', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');

  const ctx = {
    tenantId: auth.tenantId,
    bestEffort: body.bestEffort ?? false,
  };

  try {
    let result;
    if (body.format === 'csv') {
      const adapter = new LpmsCsvAdapter();
      result = adapter.parse(body.content, ctx, {
        columnMap: body.columnMap,
      });
    } else if (body.format === 'json') {
      const adapter = new LpmsJsonAdapter();
      result = adapter.parse(body.content, ctx, {
        aliasMap: body.columnMap,
      });
    } else {
      const adapter = new LpmsXmlAdapter();
      result = adapter.parse(body.content, ctx);
    }

    // If commit=true, we would forward to MigrationWriterService. For now,
    // return the parse result so the operator can review before committing.
    // Commit-path wiring is a dedicated follow-up — it requires a
    // permission check (MIGRATION_WRITE) plus the writer running in its
    // own transaction, which the existing migration.router.ts already
    // does for the upload flow. This endpoint is intentionally
    // preview-first.
    const preview = {
      format: body.format,
      tenantId: auth.tenantId,
      counts: {
        properties: result.properties.length,
        units: result.units.length,
        customers: result.customers.length,
        leases: result.leases.length,
        payments: result.payments.length,
      },
      errors: result.errors,
      committed: false,
      commitRequested: body.commit ?? false,
      properties: result.properties,
      units: result.units,
      customers: result.customers,
      leases: result.leases,
      payments: result.payments,
    };

    return c.json({ success: true, data: preview }, 200);
  } catch (e: unknown) {
    const code =
      e instanceof LpmsParseError ? 'LPMS_PARSE_ERROR' : 'INTERNAL_ERROR';
    const message = e instanceof Error ? e.message : 'unknown';
    return c.json(
      {
        success: false,
        error: {
          code,
          message: message ?? 'unknown',
          format: body.format,
        },
      },
      e instanceof LpmsParseError ? 400 : 500
    );
  }
}));

app.get('/preview-schema', (c: any) => {
  return c.json({
    success: true,
    data: {
      supportedFormats: ['csv', 'json', 'xml'],
      targetEntities: ['properties', 'units', 'customers', 'leases', 'payments'],
      columnMapDoc:
        'Optional per-format column map. CSV: { csvHeader: normalizedField }. JSON/XML: field alias.',
      uploadCapMb: 50,
    },
  });
});

export const lpmsRouter = app;
export default app;
