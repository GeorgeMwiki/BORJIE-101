/**
 * Email channel adapter — Resend transactional mail provider.
 *
 * Env-gated: requires `RESEND_API_KEY` + `EMAIL_FROM`. Uses fetch via
 * undici — no SDK dependency.
 */

import { request } from 'undici';
import type { ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const REQUIRED_ENV = ['RESEND_API_KEY', 'EMAIL_FROM'] as const;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface EmailPayload {
  readonly subject: string;
  readonly html: string;
  readonly plaintext: string;
}

function tryParse(body: string): EmailPayload | null {
  try {
    const parsed = JSON.parse(body) as Partial<EmailPayload>;
    if (
      typeof parsed.subject === 'string' &&
      typeof parsed.html === 'string' &&
      typeof parsed.plaintext === 'string'
    ) {
      return {
        subject: parsed.subject,
        html: parsed.html,
        plaintext: parsed.plaintext,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const emailAdapter: ChannelAdapter = Object.freeze({
  channel: 'email' as const,
  publish: async (
    asset: ComposedAsset,
    ctx: PublishContext,
  ): Promise<PublishResult> => {
    const env = readEnv([...REQUIRED_ENV], ctx.env);
    const missing = REQUIRED_ENV.filter((k) => env[k] === undefined);
    if (missing.length > 0) {
      return envGap('email', missing);
    }
    const payload = tryParse(asset.body);
    if (payload === null) {
      return {
        ok: false,
        code: 'INVARIANT_VIOLATION',
        message: 'email composer body is not the expected JSON shape',
      };
    }
    if (ctx.dry_run === true) {
      return {
        ok: true,
        channel_post_id: `resend-dry-${asset.id}`,
        permalink: `mailto:?subject=${encodeURIComponent(payload.subject)}`,
        published_at: new Date().toISOString(),
      };
    }
    try {
      const res = await request(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env['RESEND_API_KEY']}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env['EMAIL_FROM'],
          to: ['placeholder@example.com'],
          subject: payload.subject,
          html: payload.html,
          text: payload.plaintext,
          tags: [
            { name: 'utm_campaign', value: asset.utm_tags['utm_campaign'] ?? '' },
            { name: 'variant_id', value: asset.variant_id },
          ],
        }),
      });
      if (res.statusCode === 429) {
        return { ok: false, code: 'RATE_LIMITED', message: 'Resend 429' };
      }
      if (res.statusCode >= 400) {
        return {
          ok: false,
          code: 'PROVIDER_ERROR',
          message: `Resend ${res.statusCode}`,
        };
      }
      const body = (await res.body.json()) as { readonly id?: string };
      return {
        ok: true,
        channel_post_id: body.id ?? `resend-${asset.id}`,
        permalink: `https://resend.com/emails/${body.id ?? asset.id}`,
        published_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : 'unknown resend error',
      };
    }
  },
});
