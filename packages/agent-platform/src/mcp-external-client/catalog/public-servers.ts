/**
 * Static catalog of public MCP servers Borjie knows how to consume.
 *
 * Wave 1 — 12 entries. Each entry is *vetted*; we never connect to a
 * server the founder hasn't approved. New entries are added through
 * code review only (no runtime discovery).
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §3.
 */

import type { McpCatalogEntry } from '../types.js';

export const PUBLIC_MCP_CATALOG: ReadonlyArray<McpCatalogEntry> =
  Object.freeze([
    {
      id: 'slack',
      displayName: 'Slack',
      packageName: '@modelcontextprotocol/server-slack',
      transport: 'stdio',
      auth: 'oauth_token',
      maxTier: 1,
      description:
        'Read/write Slack channels + DMs; close the loop with mining-ops chat.',
      oauthProvider: 'slack',
      scopes: ['channels:read', 'chat:write', 'im:read', 'im:write'],
    },
    {
      id: 'github',
      displayName: 'GitHub',
      packageName: '@modelcontextprotocol/server-github',
      transport: 'stdio',
      auth: 'oauth_token',
      maxTier: 1,
      description:
        'Repo/PR/issue read+write; lets juniors file follow-ups against the Borjie repo.',
      oauthProvider: 'github',
      scopes: ['repo', 'read:org'],
    },
    {
      id: 'google-drive',
      displayName: 'Google Drive',
      packageName: '@modelcontextprotocol/server-google-drive',
      transport: 'stdio',
      auth: 'oauth_pkce',
      maxTier: 1,
      description:
        'Read/write GDrive files; mining licences + contracts live there.',
      oauthProvider: 'google',
      scopes: ['https://www.googleapis.com/auth/drive'],
    },
    {
      id: 'postgres',
      displayName: 'Postgres (external)',
      packageName: '@modelcontextprotocol/server-postgres',
      transport: 'stdio',
      auth: 'api_key',
      maxTier: 0,
      description:
        'Direct SQL to *external* Postgres clusters (customer warehouses). Read-only.',
    },
    {
      id: 'filesystem',
      displayName: 'Filesystem (sandbox)',
      packageName: '@modelcontextprotocol/server-filesystem',
      transport: 'stdio',
      auth: 'none',
      maxTier: 1,
      description:
        'Sandboxed local-filesystem read/write — sidecar use only, never on prod.',
    },
    {
      id: 'puppeteer',
      displayName: 'Puppeteer (browser)',
      packageName: '@modelcontextprotocol/server-puppeteer',
      transport: 'stdio',
      auth: 'none',
      maxTier: 1,
      description:
        'Headless browser automation — fills the gap when no API exists.',
    },
    {
      id: 'memory',
      displayName: 'Memory (KV scratchpad)',
      packageName: '@modelcontextprotocol/server-memory',
      transport: 'stdio',
      auth: 'none',
      maxTier: 0,
      description:
        'KV scratchpad shared between MCP turns; complements our persistent-memory tier.',
    },
    {
      id: 'sequential-thinking',
      displayName: 'Sequential Thinking',
      packageName: '@modelcontextprotocol/server-sequential-thinking',
      transport: 'stdio',
      auth: 'none',
      maxTier: 0,
      description:
        "Anthropic's chain-of-thought helper; useful for the cognitive engine.",
    },
    {
      id: 'notion',
      displayName: 'Notion',
      packageName: '@notionhq/notion-mcp-server',
      transport: 'stdio',
      auth: 'oauth_token',
      maxTier: 1,
      description:
        'Read/write Notion pages + databases; doc-composition (Wave 18-DOC) target.',
      oauthProvider: 'notion',
      scopes: ['read_content', 'update_content'],
    },
    {
      id: 'cloudflare',
      displayName: 'Cloudflare',
      packageName: '@cloudflare/mcp-server',
      transport: 'http',
      auth: 'api_key',
      maxTier: 1,
      description:
        'Cloudflare R2 + Workers + DNS; infra-junior reaches over here.',
    },
    {
      id: 'stripe',
      displayName: 'Stripe',
      packageName: 'stripe-mcp-server',
      transport: 'stdio',
      auth: 'api_key',
      maxTier: 1,
      description:
        'Stripe API read+write; treasury-junior reconciles via this.',
    },
    {
      id: 'linear',
      displayName: 'Linear',
      packageName: 'linear-mcp-server',
      transport: 'stdio',
      auth: 'oauth_token',
      maxTier: 1,
      description:
        'Linear issues + cycles; mining ops occasionally tracks blockers there.',
      oauthProvider: 'linear',
      scopes: ['read', 'write'],
    },
  ] as const);

/** Look a catalog entry up by id. */
export function findCatalogEntry(id: string): McpCatalogEntry | undefined {
  return PUBLIC_MCP_CATALOG.find((entry) => entry.id === id);
}

/** Returns true iff every entry in the catalog passes basic shape checks. */
export function isCatalogWellFormed(): boolean {
  const ids = new Set<string>();
  for (const entry of PUBLIC_MCP_CATALOG) {
    if (entry.id.length === 0 || entry.displayName.length === 0) return false;
    if (entry.packageName.length === 0) return false;
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
  }
  return true;
}
