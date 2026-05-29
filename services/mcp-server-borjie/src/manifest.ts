/**
 * Public MCP manifest — what /.well-known/mcp.json should return.
 *
 * The capability manifest at /.well-known/borjie-capabilities.json
 * references this object via the `mcp.well_known` key so an external
 * discovery agent can fetch one URL and learn the full MCP surface.
 */

import { BORJIE_PUBLIC_MCP_TOOLS } from './tool-catalog.js';
import { BORJIE_PUBLIC_MCP_RESOURCES } from './resources.js';
import { BORJIE_PUBLIC_MCP_PROMPTS } from './prompts.js';
import { BORJIE_SCOPE_CATALOG } from './scopes.js';

export interface BorjieMcpManifest {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly transports: ReadonlyArray<'stdio' | 'http'>;
  readonly httpEndpoint: string;
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
  readonly rateLimits: Readonly<{
    readonly readPerMinute: number;
    readonly writePerMinute: number;
    readonly draftPerHour: number;
  }>;
}

export interface ManifestOptions {
  readonly publicBaseUrl: string;
}

export function buildManifest(options: ManifestOptions): BorjieMcpManifest {
  const base = options.publicBaseUrl.replace(/\/+$/, '');
  return Object.freeze({
    name: 'borjie-mcp-server',
    version: '0.1.0',
    protocolVersion: '2024-11-05',
    transports: Object.freeze(['stdio' as const, 'http' as const]),
    httpEndpoint: `${base}/mcp`,
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
    rateLimits: Object.freeze({
      readPerMinute: 120,
      writePerMinute: 30,
      draftPerHour: 50,
    }),
  });
}
