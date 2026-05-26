/**
 * PR Wire adapter — generic IPTC NewsML / press-wire push.
 *
 * Env-gated: requires `PR_WIRE_ENDPOINT` + `PR_WIRE_API_KEY`. Posts a
 * NewsML envelope to a configurable endpoint (PR Newswire, Reuters
 * Connect, Africa News Agency all accept variants of this format).
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

const REQUIRED_ENV = ['PR_WIRE_ENDPOINT', 'PR_WIRE_API_KEY'] as const;

export const prWireAdapter: ChannelAdapter = Object.freeze({
  channel: 'pr_wire' as const,
  publish: async (
    asset: ComposedAsset,
    ctx: PublishContext,
  ): Promise<PublishResult> => {
    const env = readEnv([...REQUIRED_ENV], ctx.env);
    const missing = REQUIRED_ENV.filter((k) => env[k] === undefined);
    if (missing.length > 0) {
      return envGap('pr_wire', missing);
    }
    if (ctx.dry_run === true) {
      return {
        ok: true,
        channel_post_id: `prwire-dry-${asset.id}`,
        permalink: `${env['PR_WIRE_ENDPOINT']}/releases/${asset.id}`,
        published_at: new Date().toISOString(),
      };
    }
    const endpoint = env['PR_WIRE_ENDPOINT'];
    if (endpoint === undefined) {
      return envGap('pr_wire', ['PR_WIRE_ENDPOINT']);
    }
    try {
      const res = await request(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env['PR_WIRE_API_KEY']}`,
          'content-type': 'application/xml',
        },
        body: buildNewsMLEnvelope(asset),
      });
      if (res.statusCode === 429) {
        return { ok: false, code: 'RATE_LIMITED', message: 'PR wire 429' };
      }
      if (res.statusCode >= 400) {
        return {
          ok: false,
          code: 'PROVIDER_ERROR',
          message: `PR wire ${res.statusCode}`,
        };
      }
      return {
        ok: true,
        channel_post_id: `prwire-${asset.id}`,
        permalink: `${endpoint}/releases/${asset.id}`,
        published_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : 'unknown pr wire error',
      };
    }
  },
});

function buildNewsMLEnvelope(asset: ComposedAsset): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<newsML xmlns="http://iptc.org/std/NewsML/2003-10-10/">
  <newsItem guid="${asset.id}">
    <itemMeta><pubStatus>usable</pubStatus></itemMeta>
    <contentSet>
      <inlineXML><![CDATA[${asset.body}]]></inlineXML>
    </contentSet>
  </newsItem>
</newsML>`;
}
