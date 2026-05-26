/**
 * IoT router — Wave 8 (S3 gap closure)
 *
 * Mounted at `/api/v1/iot`. Accepts sensor registration, observation
 * ingestion (push + webhook), anomaly queries + acknowledgements.
 *
 *   POST /sensors                         — register sensor
 *   GET  /sensors                         — list sensors (?kind=, ?unitId=)
 *   GET  /sensors/:id                     — sensor detail
 *   POST /sensors/:id/observations        — ingest single observation
 *   GET  /sensors/:id/observations        — list observations (?from=, ?limit=)
 *   GET  /anomalies                       — list anomalies (?severity=, ?sensorId=, ?unresolved=true)
 *   POST /anomalies/:id/acknowledge
 *   POST /anomalies/:id/resolve
 */
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { IotService } from '@borjie/domain-services/iot';
import { authMiddleware } from '../middleware/hono-auth';

/**
 * The router dispatches at runtime — we depend only on Hono's generic
 * `Context.get/json` surface, so the broad context type is sufficient.
 *
 * Note: handlers wrapped by `zValidator` use `any` for the context type
 * because Hono v4's MiddlewareHandler inference does not propagate the
 * validator's output shape through a downstream `withSecurityEvents`
 * wrapper. Pinning to `Context` would erase `c.req.valid('json')`.
 */
type AnyContext = Context;

import { withSecurityEvents } from '@borjie/observability';
const SensorKindSchema = z.enum([
  'water_meter',
  'electricity_meter',
  'gas_meter',
  'temperature',
  'humidity',
  'occupancy',
  'door_lock',
  'smoke',
  'co',
  'vibration',
  'satellite_image',
  'drone_scan',
  'custom',
]);

const RegisterSensorSchema = z.object({
  kind: SensorKindSchema,
  externalId: z.string().min(1).max(200),
  vendor: z.string().min(1).max(100),
  unitId: z.string().max(100).optional(),
  propertyId: z.string().max(100).optional(),
  geoNodeId: z.string().max(100).optional(),
  label: z.string().max(200).optional(),
  unitOfMeasure: z.string().max(40).optional(),
  samplingIntervalSeconds: z.number().int().positive().optional(),
  expectedMin: z.number().optional(),
  expectedMax: z.number().optional(),
  silenceThresholdSeconds: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ObservationSchema = z.object({
  observedAt: z.string().datetime().optional(),
  numericValue: z.number().optional(),
  booleanValue: z.boolean().optional(),
  stringValue: z.string().max(500).optional(),
  jsonbValue: z.record(z.string(), z.unknown()).optional(),
  quality: z.enum(['good', 'suspect', 'bad']).optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

const AckSchema = z.object({
  notes: z.string().max(1000).optional(),
});

const ResolveSchema = z.object({
  notes: z.string().max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: AnyContext): IotService | undefined {
  const services = (c.get('services') as { iot?: IotService } | undefined) ?? {};
  return services.iot;
}

function notImplemented(c: AnyContext) {
  return c.json(
    {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'IoT service not wired' },
    },
    503
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/sensors', zValidator('json', RegisterSensorSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const sensor = await s.registerSensor(auth.tenantId, body, auth.userId);
    return c.json({ success: true, data: sensor }, 201);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    const status = err?.code === 'DUPLICATE' ? 409 : err?.code === 'VALIDATION' ? 400 : 500;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      status
    );
  }
}));

app.get('/sensors', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  // kind is a free-form query string; service validates the value
  // against its own enum before querying.
  const kindRaw = c.req.query('kind');
  const unitIdRaw = c.req.query('unitId');
  const propertyIdRaw = c.req.query('propertyId');
  const activeRaw = c.req.query('active');
  const filters = {
    ...(kindRaw ? { kind: kindRaw as z.infer<typeof SensorKindSchema> } : {}),
    ...(unitIdRaw ? { unitId: unitIdRaw } : {}),
    ...(propertyIdRaw ? { propertyId: propertyIdRaw } : {}),
    ...(activeRaw === 'false'
      ? { active: false }
      : activeRaw === 'true'
        ? { active: true }
        : {}),
  };
  const sensors = await s.listSensors(auth.tenantId, filters);
  return c.json({ success: true, data: sensors });
});

app.get('/sensors/:id', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const id = c.req.param('id');
  if (!id) {
    return c.json(
      { success: false, error: { code: 'INVALID_PARAM', message: 'id required' } },
      400
    );
  }
  const sensor = await s.getSensor(auth.tenantId, id);
  if (!sensor) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'sensor not found' } },
      404
    );
  }
  return c.json({ success: true, data: sensor });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/sensors/:id/observations', zValidator('json', ObservationSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const result = await s.ingestObservation(
      auth.tenantId,
      {
        sensorId: c.req.param('id'),
        observedAt: body.observedAt ? new Date(body.observedAt) : new Date(),
        numericValue: body.numericValue,
        booleanValue: body.booleanValue,
        stringValue: body.stringValue,
        jsonbValue: body.jsonbValue,
        quality: body.quality ?? 'good',
        rawPayload: body.rawPayload,
      },
      auth.userId
    );
    return c.json({ success: true, data: result }, 202);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    const status = err?.code === 'NOT_FOUND' ? 404 : 400;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      status
    );
  }
}));

app.get('/sensors/:id/observations', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const id = c.req.param('id');
  if (!id) {
    return c.json(
      { success: false, error: { code: 'INVALID_PARAM', message: 'id required' } },
      400
    );
  }
  const fromRaw = c.req.query('from');
  const since = fromRaw ? new Date(fromRaw) : undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
  const items = await s.listObservations(auth.tenantId, id, {
    ...(since !== undefined ? { since } : {}),
    limit,
  });
  return c.json({ success: true, data: items });
});

app.get('/anomalies', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  // severity is a free-form query string. Only forward values that match
  // the domain `IotAnomalySeverity` union — anything else is dropped so
  // the service receives a clean `undefined` instead of a bogus literal.
  const sevRaw = c.req.query('severity');
  const sevAllowed = ['low', 'medium', 'high', 'critical'] as const;
  const severity = sevRaw && (sevAllowed as readonly string[]).includes(sevRaw)
    ? (sevRaw as typeof sevAllowed[number])
    : undefined;
  const sensorIdRaw = c.req.query('sensorId');
  const unresolvedRaw = c.req.query('unresolved');
  const filters = {
    ...(sensorIdRaw ? { sensorId: sensorIdRaw } : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(unresolvedRaw === 'true' ? { unresolved: true } : {}),
  };
  const items = await s.listAnomalies(auth.tenantId, filters);
  return c.json({ success: true, data: items });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/anomalies/:id/acknowledge', zValidator('json', AckSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  // AckSchema's `notes` is informational — the service signature only
  // takes (tenantId, anomalyId, userId), so we discard the body field.
  c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const out = await s.acknowledgeAnomaly(auth.tenantId, c.req.param('id'), auth.userId);
    return c.json({ success: true, data: out });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      err?.code === 'NOT_FOUND' ? 404 : 400
    );
  }
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- zValidator output type does not propagate through withSecurityEvents wrapper.
app.post('/anomalies/:id/resolve', zValidator('json', ResolveSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    // Service requires non-empty resolution notes — fall back to a placeholder
    // when the optional schema field is absent so the call still validates.
    const out = await s.resolveAnomaly(auth.tenantId, c.req.param('id'), body.notes ?? 'resolved', auth.userId);
    return c.json({ success: true, data: out });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      err?.code === 'NOT_FOUND' ? 404 : 400
    );
  }
}));

export const iotRouter = app;
export default app;
