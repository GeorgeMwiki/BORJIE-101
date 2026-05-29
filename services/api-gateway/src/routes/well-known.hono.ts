/**
 * /.well-known/* — capability discovery for external agents.
 *
 * Wave AGENTIC-PLATFORM. Two manifests crawlers and MCP clients use to
 * discover Borjie's agent surface without needing a human in the loop:
 *
 *   GET /.well-known/borjie-capabilities.json
 *     The canonical Borjie capability descriptor. Includes auth modes,
 *     MCP discovery, REST/SDK/CLI entry points, available scopes, rate
 *     limits, webhook contract, languages, regions, compliance.
 *
 *   GET /.well-known/mcp.json
 *     RFC-style Model Context Protocol discovery document. Points at
 *     both the stdio entrypoint (npx ...) and the HTTP entrypoint
 *     (https://api.borjie.app/mcp), plus the OAuth endpoints required
 *     to mint a token before opening the MCP transport.
 *
 * Both routes are PUBLIC (no auth) by intent — discovery must work
 * before the agent has any credentials. They are also CDN-cacheable.
 */

import { Hono } from 'hono';

const app = new Hono();

const PUBLIC_API_URL = process.env.BORJIE_PUBLIC_API_URL ?? 'https://api.borjie.app';
const PUBLIC_OWNER_WEB_URL = process.env.BORJIE_OWNER_WEB_URL ?? 'https://owner.borjie.app';
const PUBLIC_DOCS_URL = process.env.BORJIE_PUBLIC_DOCS_URL ?? 'https://borjie.app/docs';

interface CapabilityManifest {
  readonly name: string;
  readonly tagline: string;
  readonly version: string;
  readonly auth: {
    readonly modes: readonly string[];
    readonly device_endpoint: string;
    readonly token_endpoint: string;
    readonly revoke_endpoint: string;
    readonly verify_url: string;
  };
  readonly mcp: {
    readonly stdio_command: string;
    readonly http_url: string;
    readonly discovery: string;
  };
  readonly rest: {
    readonly base_url: string;
    readonly openapi: string;
  };
  readonly cli: {
    readonly install: string;
    readonly bin: string;
    readonly docs: string;
  };
  readonly sdk: {
    readonly typescript: string;
    readonly runtimes: readonly string[];
  };
  readonly scopes: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
  }>;
  readonly rate_limits: Readonly<Record<string, string>>;
  readonly webhooks: {
    readonly delivery: string;
    readonly signing: string;
    readonly idempotency: string;
  };
  readonly languages: readonly string[];
  readonly regions: readonly string[];
  readonly compliance: readonly string[];
}

const CAPABILITIES: CapabilityManifest = {
  name: 'Borjie',
  tagline:
    'Mining estate planning, management, and intelligence OS for Tanzanian and pan-African ASM',
  version: '0.1.0',
  auth: {
    modes: ['oauth2_device_flow', 'supabase_jwt'],
    device_endpoint: '/api/v1/oauth/device/code',
    token_endpoint: '/api/v1/oauth/token',
    revoke_endpoint: '/api/v1/oauth/revoke',
    verify_url: `${PUBLIC_OWNER_WEB_URL.replace(/\/+$/, '')}/oauth/confirm`,
  },
  mcp: {
    stdio_command: 'npx @borjie/mcp-server-borjie',
    http_url: `${PUBLIC_API_URL.replace(/\/+$/, '')}/mcp`,
    discovery: '/.well-known/mcp.json',
  },
  rest: {
    base_url: PUBLIC_API_URL,
    openapi: '/api/v1/openapi.json',
  },
  cli: {
    install: 'npm install -g @borjie/cli',
    bin: 'borjie',
    docs: `${PUBLIC_DOCS_URL.replace(/\/+$/, '')}/cli`,
  },
  sdk: {
    typescript: '@borjie/api-sdk',
    runtimes: ['node20+', 'bun', 'deno', 'browser'],
  },
  scopes: [
    {
      id: 'owner:read',
      description:
        'Read owner cockpit data (drafts, reminders, decisions, entities)',
    },
    {
      id: 'owner:write',
      description: 'Create/update owner data (excluding money)',
    },
    {
      id: 'owner:draft',
      description: 'Create/edit/lock document drafts',
    },
    {
      id: 'owner:reminders',
      description: 'Schedule reminders',
    },
    {
      id: 'owner:share',
      description: 'Generate share links',
    },
    {
      id: 'admin:read',
      description: 'Read internal admin data (Borjie team only)',
    },
  ],
  rate_limits: {
    default: '60 req/min per token',
    chat: '20 req/min per token',
    drafts: '10 req/min per token',
  },
  webhooks: {
    delivery: 'at-least-once',
    signing: 'HMAC-SHA256 with X-Borjie-Signature header',
    idempotency: 'Idempotency-Key request header',
  },
  languages: ['sw', 'en'],
  regions: ['TZ', 'KE', 'UG', 'RW', 'ZM'],
  compliance: ['PCCB', 'PDPA-TZ', 'Mining-Act-2010', 'OSHA-TZ'],
};

interface McpDiscovery {
  readonly mcp_version: string;
  readonly server_name: string;
  readonly transports: ReadonlyArray<{
    readonly type: 'stdio' | 'http' | 'sse';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly url?: string;
  }>;
  readonly auth: {
    readonly type: 'oauth2_device';
    readonly device_endpoint: string;
    readonly token_endpoint: string;
    readonly revoke_endpoint: string;
    readonly verification_uri: string;
    readonly scopes: readonly string[];
  };
  readonly capabilities: {
    readonly tools: boolean;
    readonly resources: boolean;
    readonly prompts: boolean;
    readonly logging: boolean;
  };
}

const MCP_DISCOVERY: McpDiscovery = {
  mcp_version: '2024-11-05',
  server_name: '@borjie/mcp-server-borjie',
  transports: [
    {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@borjie/mcp-server-borjie'],
    },
    {
      type: 'http',
      url: `${PUBLIC_API_URL.replace(/\/+$/, '')}/mcp`,
    },
  ],
  auth: {
    type: 'oauth2_device',
    device_endpoint: `${PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/oauth/device/code`,
    token_endpoint: `${PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/oauth/token`,
    revoke_endpoint: `${PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/oauth/revoke`,
    verification_uri: `${PUBLIC_OWNER_WEB_URL.replace(/\/+$/, '')}/oauth/confirm`,
    scopes: CAPABILITIES.scopes.map((s) => s.id),
  },
  capabilities: {
    tools: true,
    resources: true,
    prompts: true,
    logging: true,
  },
};

app.get('/borjie-capabilities.json', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  c.header('Content-Type', 'application/json; charset=utf-8');
  return c.json(CAPABILITIES, 200);
});

app.get('/mcp.json', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  c.header('Content-Type', 'application/json; charset=utf-8');
  return c.json(MCP_DISCOVERY, 200);
});

export const wellKnownRouter = app;
export default app;
