/**
 * Voice router (Wave 11).
 *
 * Mounted at `/api/v1/voice`. Tenant-isolated via auth middleware.
 *
 *   POST /transcribe   — audio (multipart) or base64 JSON → transcript
 *   POST /synthesize   — text → audio bytes
 *
 * Delegates to the voice router (packages/ai-copilot/src/voice). Cost is
 * logged per-tenant via the composed CostLedger.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const SynthesizeSchema = z.object({
  text: z.string().min(1).max(10_000),
  language: z.enum(['en', 'sw', 'mixed']).default('en'),
  voiceId: z.string().min(1).max(200).optional(),
  format: z.string().min(1).max(40).optional(),
});

const TranscribeJsonSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).max(80).optional(),
  language: z.enum(['en', 'sw', 'mixed']).default('en'),
  diarize: z.boolean().optional(),
  prompt: z.string().max(1000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.voice;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Voice service not wired into api-gateway context',
      },
    },
    503
  );
}

function mapVoiceErr(c: any, err: any) {
  const code = err?.code ?? 'PROVIDER_ERROR';
  const status =
    code === 'INVALID_AUDIO'
      ? 400
      : code === 'RATE_LIMIT'
        ? 429
        : code === 'TIMEOUT'
          ? 504
          : code === 'MISSING_KEY'
            ? 503
            : code === 'UNSUPPORTED_LANGUAGE'
              ? 422
              : 502;
  return c.json(
    { success: false, error: { code, message: err?.message ?? 'voice error' } },
    status
  );
}

app.post('/transcribe', zValidator('json', TranscribeJsonSchema), withSecurityEvents({ action: 'voice.create', resource: 'voice', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const voice = svc(c);
  if (!voice) return notImplemented(c);
  let bytes: Uint8Array;
  try {
    const binary = Buffer.from(body.audioBase64, 'base64');
    bytes = new Uint8Array(binary);
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_AUDIO', message: 'bad base64 payload' } },
      400
    );
  }
  const result = await voice.transcribe(
    { tenantId: auth.tenantId, userId: auth.userId, correlationId: c.req.header('x-correlation-id') },
    {
      audio: bytes,
      mimeType: body.mimeType ?? 'audio/mpeg',
      language: body.language,
      diarize: body.diarize,
      prompt: body.prompt,
    }
  );
  if (!result.success) return mapVoiceErr(c, result.error);
  return c.json({ success: true, data: result.data });
}));

app.post('/synthesize', zValidator('json', SynthesizeSchema), withSecurityEvents({ action: 'voice.create', resource: 'voice', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const voice = svc(c);
  if (!voice) return notImplemented(c);
  const result = await voice.synthesize(
    { tenantId: auth.tenantId, userId: auth.userId, correlationId: c.req.header('x-correlation-id') },
    {
      text: body.text,
      language: body.language,
      voiceId: body.voiceId,
      format: body.format,
    }
  );
  if (!result.success) return mapVoiceErr(c, result.error);
  // Stream the audio bytes back as base64 JSON (keeps the API symmetric and
  // avoids CORS/streaming headaches for mobile clients).
  const audioBase64 = Buffer.from(result.data.audio).toString('base64');
  return c.json({
    success: true,
    data: {
      audioBase64,
      mimeType: result.data.mimeType,
      providerId: result.data.providerId,
      voiceId: result.data.voiceId,
      model: result.data.model,
    },
  });
}));

export const voiceRouter = app;
export default app;
