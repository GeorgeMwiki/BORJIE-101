/**
 * Tests for the /api/v1/mining/brain/vision-turn endpoint.
 *
 * Contract coverage (per the photo-advisor agent spec):
 *  - 400 on missing image
 *  - 400 on missing prompt
 *  - 400 on mime type that is not image/jpeg|png
 *  - 413 on image > 10 MB
 *  - 401 on missing Authorization header
 *  - 503 when ANTHROPIC_VISION_ENABLED is OFF
 *  - 503 when ANTHROPIC_VISION_ENABLED is ON (BRAIN_MULTIMODAL_NOT_WIRED)
 *  - path resolves to /api/v1/mining/brain/vision-turn when mounted under
 *    the mining router
 *
 * The JWT secret is pinned BEFORE the module-under-test imports so the
 * authMiddleware uses the same HS256 secret as `generateToken` below.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { miningBrainVisionRouter } from '../brain-vision.hono';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bareApp(): Hono {
  const app = new Hono();
  // Mount under /brain to mirror the mining-router mount-point
  // (`mining.route('/brain', miningBrainVisionRouter)`).
  app.route('/brain', miningBrainVisionRouter);
  return app;
}

function miningMountedApp(): Hono {
  // Simulates the full /api/v1/mining/brain/* mount chain so we can verify
  // path resolution end-to-end.
  const mining = new Hono();
  mining.route('/brain', miningBrainVisionRouter);
  const v1 = new Hono();
  v1.route('/mining', mining);
  const api = new Hono();
  api.route('/api/v1', v1);
  return api;
}

function bearer(opts: { userId?: string; tenantId?: string; role?: UserRole } = {}): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'user_1',
    tenantId: opts.tenantId ?? 'tenant_1',
    role: (opts.role ?? UserRole.TENANT_ADMIN) as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

/** Build a tiny but valid base64 payload (a one-pixel JPEG-ish blob).
 *  Size is well under 10 MB. */
function tinyBase64(): string {
  return Buffer.from('hello-borjie-vision').toString('base64');
}

/** Build a base64 payload that decodes to >10 MB. */
function oversizeBase64(): string {
  // 10 MB + 1 byte of decoded data, base64-encoded.
  return Buffer.alloc(10 * 1024 * 1024 + 1, 0x42).toString('base64');
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    image: {
      base64: tinyBase64(),
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    },
    prompt: 'Niambie kuhusu eneo hili',
    location: { latitude: -3.4287, longitude: 32.9183, accuracy: 8 },
    language: 'sw',
    ...overrides,
  };
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

const ORIGINAL_VISION_FLAG = process.env.ANTHROPIC_VISION_ENABLED;

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

afterAll(() => {
  if (ORIGINAL_VISION_FLAG === undefined) {
    delete process.env.ANTHROPIC_VISION_ENABLED;
  } else {
    process.env.ANTHROPIC_VISION_ENABLED = ORIGINAL_VISION_FLAG;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mining brain-vision router — auth gate', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await postJson(bareApp(), '/brain/vision-turn', validBody());
    expect(res.status).toBe(401);
  });
});

describe('mining brain-vision router — request validation', () => {
  it('returns 400 when the image field is missing', async () => {
    const body = validBody();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (body as Record<string, unknown>).image;
    const res = await postJson(bareApp(), '/brain/vision-turn', body, {
      authorization: bearer(),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 when the prompt field is missing', async () => {
    const body = validBody();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (body as Record<string, unknown>).prompt;
    const res = await postJson(bareApp(), '/brain/vision-turn', body, {
      authorization: bearer(),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 when the mime type is not an allowed image/* type', async () => {
    const body = validBody({
      image: {
        base64: tinyBase64(),
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
    const res = await postJson(bareApp(), '/brain/vision-turn', body, {
      authorization: bearer(),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('MIME_NOT_IMAGE');
  });

  it('returns 413 when image size exceeds 10 MB', async () => {
    // Use the declared sizeBytes field first (covers untrusted clients
    // who declare a fake-small payload would still fail the decoded
    // length check; this case fails the declared-size check first).
    const body = validBody({
      image: {
        base64: tinyBase64(),
        mimeType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024 + 1,
      },
    });
    const res = await postJson(bareApp(), '/brain/vision-turn', body, {
      authorization: bearer(),
    });
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('IMAGE_TOO_LARGE');
  });

  it('returns 413 when the decoded base64 payload exceeds 10 MB even if declared size is small', async () => {
    const body = validBody({
      image: {
        base64: oversizeBase64(),
        mimeType: 'image/jpeg',
        sizeBytes: 1024, // declared size lies; defence-in-depth check catches it
      },
    });
    const res = await postJson(bareApp(), '/brain/vision-turn', body, {
      authorization: bearer(),
    });
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe('IMAGE_TOO_LARGE');
  });
});

describe('mining brain-vision router — vision capability flag', () => {
  it('returns 503 with BACKEND_VISION_UNAVAILABLE when ANTHROPIC_VISION_ENABLED is OFF', async () => {
    delete process.env.ANTHROPIC_VISION_ENABLED;
    const res = await postJson(bareApp(), '/brain/vision-turn', validBody(), {
      authorization: bearer(),
    });
    expect(res.status).toBe(503);
    const payload = (await res.json()) as { error?: string; code?: string };
    expect(payload.error).toBe('BACKEND_VISION_UNAVAILABLE');
    expect(payload.code).toBe('VISION_CAPABILITY_DISABLED');
  });

  it('returns 503 BRAIN_MULTIMODAL_NOT_WIRED when ANTHROPIC_VISION_ENABLED is ON but orchestrator is not yet wired', async () => {
    process.env.ANTHROPIC_VISION_ENABLED = 'true';
    const res = await postJson(bareApp(), '/brain/vision-turn', validBody(), {
      authorization: bearer({ userId: 'user_brain_wired', tenantId: 'tenant_brain_wired' }),
    });
    expect(res.status).toBe(503);
    const payload = (await res.json()) as { error?: string; code?: string; message?: string };
    expect(payload.error).toBe('BACKEND_VISION_UNAVAILABLE');
    expect(payload.code).toBe('BRAIN_MULTIMODAL_NOT_WIRED');
    expect(payload.message).toContain('multimodal');
  });
});

describe('mining brain-vision router — path resolution', () => {
  it('mounts under /api/v1/mining/brain/vision-turn end-to-end', async () => {
    // Use a fresh tenant/user so the rate-limit bucket is independent of
    // the other tests in this file.
    delete process.env.ANTHROPIC_VISION_ENABLED;
    const res = await postJson(
      miningMountedApp(),
      '/api/v1/mining/brain/vision-turn',
      validBody(),
      { authorization: bearer({ userId: 'user_path', tenantId: 'tenant_path' }) },
    );
    // Endpoint exists (not 404). With vision OFF and the rate bucket
    // fresh, the response should be a 503 from the vision-flag guard.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(503);
  });
});
