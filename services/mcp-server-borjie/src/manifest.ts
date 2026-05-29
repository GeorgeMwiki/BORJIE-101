/**
 * Public MCP manifest — what /.well-known/mcp.json should return.
 *
 * The capability manifest at /.well-known/borjie-capabilities.json
 * references this object via the `mcp.well_known` key so an external
 * discovery agent can fetch one URL and learn the full MCP surface.
 *
 * Surfaces all 12 SOTA primitives so any client can pre-check before
 * connecting:
 *
 *   1. transports: stdio | http | sse        (POST /mcp + GET /mcp/sse)
 *   2. sampling/createMessage
 *   3. roots/list + notifications/roots/list_changed
 *   4. logging/setLevel + logging/message notifications
 *   5. $/progress notifications
 *   6. resources/subscribe + notifications/resources/updated
 *   7. $/result_partial streaming
 *   8. session/resume + session/checkpoint + session/setState
 *   9. actions/navigate|prefill|share|undo
 *  10. per-scope rate limit (token bucket)
 *  11. four-eye approval for kill_switch.* | four_eye.* | sovereign.* | policy_rollout.*
 *  12. tools/list?capability=… + resources/list?since=… + workspace/state
 */

import { BORJIE_PUBLIC_MCP_TOOLS } from './tool-catalog.js';
import { BORJIE_PUBLIC_MCP_RESOURCES } from './resources.js';
import { BORJIE_PUBLIC_MCP_PROMPTS } from './prompts.js';
import { BORJIE_SCOPE_CATALOG } from './scopes.js';
import { DEFAULT_RATE_LIMITS } from './rate-limit.js';
import { FOUR_EYE_PREFIXES } from './four-eye.js';

export interface BorjieMcpManifest {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly transports: ReadonlyArray<'stdio' | 'http' | 'sse'>;
  readonly httpEndpoint: string;
  readonly sseEndpoint: string;
  readonly stdioCommand: string;
  readonly auth: {
    readonly flow: 'oauth2_device';
    readonly deviceCodeEndpoint: string;
    readonly tokenEndpoint: string;
    readonly revokeEndpoint: string;
  };
  readonly scopes: ReadonlyArray<{
    readonly scope: string;
    readonly displayNameEn: string;
    readonly displayNameSw: string;
    readonly descriptionEn: string;
    readonly descriptionSw: string;
    readonly grantableByOwner: boolean;
  }>;
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly requiredScopes: ReadonlyArray<string>;
    readonly stakes: string;
    readonly isWrite: boolean;
  }>;
  readonly resources: ReadonlyArray<{
    readonly uri: string;
    readonly name: string;
  }>;
  readonly prompts: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly rateLimits: Readonly<Record<string, {
    readonly capacity: number;
    readonly refillPerMinute: number;
  }>>;
  readonly primitives: {
    readonly sse: boolean;
    readonly sampling: boolean;
    readonly roots: boolean;
    readonly logging: boolean;
    readonly progress: boolean;
    readonly resultPartial: boolean;
    readonly subscriptions: boolean;
    readonly sessions: boolean;
    readonly actions: ReadonlyArray<'navigate' | 'prefill' | 'share' | 'undo'>;
    readonly perScopeRateLimit: boolean;
    readonly fourEye: ReadonlyArray<string>;
    readonly workspaceMirror: boolean;
    readonly discoveryFilters: boolean;
  };
}

export interface ManifestOptions {
  readonly publicBaseUrl: string;
}

export function buildManifest(options: ManifestOptions): BorjieMcpManifest {
  const base = options.publicBaseUrl.replace(/\/+$/, '');
  return Object.freeze({
    name: 'borjie-mcp-server',
    version: '0.2.0',
    protocolVersion: '2024-11-05',
    transports: Object.freeze(['stdio' as const, 'http' as const, 'sse' as const]),
    httpEndpoint: `${base}/mcp`,
    sseEndpoint: `${base}/mcp/sse`,
    stdioCommand: 'npx -y @borjie/mcp-server-borjie',
    auth: Object.freeze({
      flow: 'oauth2_device' as const,
      deviceCodeEndpoint: `${base}/oauth/device/code`,
      tokenEndpoint: `${base}/oauth/device/token`,
      revokeEndpoint: `${base}/oauth/revoke`,
    }),
    scopes: BORJIE_SCOPE_CATALOG.map((s) => ({
      scope: s.scope,
      displayNameEn: s.displayNameEn,
      displayNameSw: s.displayNameSw,
      descriptionEn: s.descriptionEn,
      descriptionSw: s.descriptionSw,
      grantableByOwner: s.grantableByOwner,
    })),
    tools: BORJIE_PUBLIC_MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      requiredScopes: t.requiredScopes,
      stakes: t.stakes,
      isWrite: t.isWrite,
    })),
    resources: BORJIE_PUBLIC_MCP_RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
    })),
    prompts: BORJIE_PUBLIC_MCP_PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
    })),
    rateLimits: Object.freeze(
      Object.fromEntries(
        Object.entries(DEFAULT_RATE_LIMITS).map(([scope, cfg]) => [
          scope,
          Object.freeze({
            capacity: cfg.capacity,
            refillPerMinute: cfg.refillPerMinute,
          }),
        ]),
      ),
    ),
    primitives: Object.freeze({
      sse: true,
      sampling: true,
      roots: true,
      logging: true,
      progress: true,
      resultPartial: true,
      subscriptions: true,
      sessions: true,
      actions: Object.freeze(['navigate', 'prefill', 'share', 'undo'] as const),
      perScopeRateLimit: true,
      fourEye: Object.freeze([...FOUR_EYE_PREFIXES]),
      workspaceMirror: true,
      discoveryFilters: true,
    }),
  });
}
