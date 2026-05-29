/**
 * Tests for the brain-compose ghost-text endpoint (Roadmap R9).
 *
 * Covers:
 *   - 401 without bearer token
 *   - empty suggestion for short / unknown input
 *   - bilingual lookup table (sw vs en)
 *   - longest-prefix preference
 *   - 400 validation when text is empty
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import {
  brainComposeRouter,
  lookupSuggestion,
} from '../routes/brain-compose.hono';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: UserRole.ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount() {
  const app = new Hono();
  app.route('/brain', brainComposeRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

describe('lookupSuggestion (pure)', () => {
  it('returns empty string for empty input', () => {
    expect(lookupSuggestion('', 'sw').suggestion).toBe('');
  });

  it('returns empty string for unknown prefix', () => {
    expect(
      lookupSuggestion('quantum computing for miners', 'en').suggestion,
    ).toBe('');
  });

  it('matches a known prefix in English', () => {
    const r = lookupSuggestion('cash flow', 'en');
    expect(r.suggestion).toBe(' this week');
    expect(r.cached).toBe(true);
  });

  it('matches a known prefix in Swahili', () => {
    const r = lookupSuggestion('cash flow', 'sw');
    expect(r.suggestion).toBe(' wiki hii');
  });

  it('matches mid-sentence prefixes', () => {
    const r = lookupSuggestion('what is the cash runway', 'en');
    expect(r.suggestion).toBe(' for the next 30 days');
  });

  it('prefers the longest prefix', () => {
    // "cash position" is longer than "cash flow"; both could be
    // suffixed but the longer one wins.
    const r = lookupSuggestion('show me the cash position', 'en');
    expect(r.suggestion).toBe(' across all sites');
  });

  it('returns the Swahili stub for sw-only prefixes', () => {
    const r = lookupSuggestion('Nina', 'sw');
    expect(r.suggestion).toContain('wasiwasi');
  });

  it('returns empty for sw-only prefix asked in en (no English completion)', () => {
    const r = lookupSuggestion('nina', 'en');
    expect(r.suggestion).toBe('');
  });
});

describe('POST /brain/compose/suggest', () => {
  it('rejects without token (401)', async () => {
    const app = mount();
    const res = await app.request('/brain/compose/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'cash flow', language: 'sw' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects empty body via zod', async () => {
    const app = mount();
    const res = await app.request('/brain/compose/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ text: '', language: 'sw' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns suggestion on the happy path', async () => {
    const app = mount();
    const res = await app.request('/brain/compose/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ text: 'cash flow', language: 'sw' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { suggestion: string; cached: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.suggestion).toBe(' wiki hii');
    expect(body.data.cached).toBe(true);
  });

  it('defaults to Swahili when language is omitted', async () => {
    const app = mount();
    const res = await app.request('/brain/compose/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ text: 'cash flow' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { suggestion: string };
    };
    expect(body.data.suggestion).toBe(' wiki hii');
  });

  it('returns empty suggestion for unknown input', async () => {
    const app = mount();
    const res = await app.request('/brain/compose/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        text: 'quantum computing for miners',
        language: 'en',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { suggestion: string };
    };
    expect(body.data.suggestion).toBe('');
  });
});
