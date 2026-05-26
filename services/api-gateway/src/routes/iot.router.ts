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

app.post('/sensors', zValidator('json', RegisterSensorSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: AnyContext) => {
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
  const filters = {
    kind: (c.req.query('kind') ?? undefined) as z.infer<typeof SensorKindSchema> | undefined,
    unitId: c.req.query('unitId') || undefined,
    propertyId: c.req.query('propertyId') || undefined,
    active:
      c.req.query('active') === 'false'
        ? false
        : c.req.query('active') === 'true'
          ? true
          : undefined,
  };
  const sensors = await s.listSensors(auth.tenantId, filters);
  return c.json({ success: true, data: sensors });
});

app.get('/sensors/:id', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const sensor = await s.getSensor(auth.tenantId, c.req.param('id'));
  if (!sensor) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'sensor not found' } },
      404
    );
  }
  return c.json({ success: true, data: sensor });
});

app.post('/sensors/:id/observations', zValidator('json', ObservationSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: AnyContext) => {
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
  const from = c.req.query('from') ? new Date(c.req.query('from')) : undefined;
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
  const items = await s.listObservations(auth.tenantId, c.req.param('id'), { from, limit });
  return c.json({ success: true, data: items });
});

app.get('/anomalies', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const filters = {
    sensorId: c.req.query('sensorId') || undefined,
    // severity is a free-form query string; service validates the value.
    severity: (c.req.query('severity') ?? undefined) as
      | 'info'
      | 'warning'
      | 'critical'
      | undefined,
    unresolvedOnly: c.req.query('unresolved') === 'true' ? true : undefined,
  };
  const items = await s.listAnomalies(auth.tenantId, filters);
  return c.json({ success: true, data: items });
});

app.post('/anomalies/:id/acknowledge', zValidator('json', AckSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const out = await s.acknowledgeAnomaly(auth.tenantId, c.req.param('id'), auth.userId, body.notes);
    return c.json({ success: true, data: out });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      err?.code === 'NOT_FOUND' ? 404 : 400
    );
  }
}));

app.post('/anomalies/:id/resolve', zValidator('json', ResolveSchema), withSecurityEvents({ action: 'iot.create', resource: 'iot', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const out = await s.resolveAnomaly(auth.tenantId, c.req.param('id'), auth.userId, body.notes);
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
