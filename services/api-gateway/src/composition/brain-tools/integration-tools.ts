/**
 * Integration-fabric brain tools — the MD's universal outward reach.
 *
 * THREE generative tools (never 21 per-connector hardcodes):
 *
 *   - `integration.connector.list`   LOW stakes, read-only. Surfaces the
 *     full connector catalog + this tenant's connection state so the MD
 *     can answer "what can you integrate with?" and "is Slack connected?"
 *     from live data.
 *
 *   - `integration.connector.connect_start` LOW stakes, read-only. Mints
 *     the provider authorize URL (signed single-use state) so the MD can
 *     hand the owner a connect link in chat. The HUMAN completes consent
 *     in the browser; the token exchange + sealing happens ONLY on the
 *     provider-initiated callback route — NEVER through the brain.
 *
 *   - `integration.connector.invoke` HIGH stakes, isWrite,
 *     requiresPolicyRuleLiteral. Invoking an external SaaS is an EGRESS
 *     WRITE — data leaves the estate — so it must hit literal policy
 *     rules (no reason-resolver generalisation, per the CLAUDE.md hard
 *     rule) and flows through the autonomy gate + inviolable rails
 *     before the route is reached.
 *
 * All defer via `ctx.httpClient` (loopback, tenant-pinned service
 * token) to `/integrations/connectors` — the ONE governed fabric route.
 * The route degrades honestly: a connector the tenant has not connected
 * returns a structured `{ connected:false, reason }` envelope, never
 * fabricated data, never a crash. A 22nd connector becomes reachable by
 * these same tools with ZERO tool changes (generative seams:
 * composition/connector-catalog.ts + connector-oauth-descriptors.ts).
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ---------- integration.connector.list ----------

const ListInput = z.object({});

const ListOutput = z.object({
  connectors: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      category: z.string(),
      description: z.string(),
      connected: z.boolean(),
      accountCount: z.number(),
      reason: z.string().optional(),
      actions: z.array(
        z.object({
          id: z.string(),
          description: z.string(),
          isWrite: z.boolean(),
        }),
      ),
    }),
  ),
  total: z.number(),
});

export const integrationConnectorListTool: PersonaToolDescriptor<
  typeof ListInput,
  typeof ListOutput
> = {
  id: 'integration.connector.list',
  name: 'List external integrations',
  description:
    'List every external tool/platform connector Borjie can integrate with ' +
    '(Slack, email, calendar, Salesforce, HubSpot, Jira, GitHub, WhatsApp, ' +
    'Zoom, social platforms, …) plus whether THIS tenant has connected each ' +
    'one and which actions each supports. Read-only — use it to answer ' +
    '"what can you integrate with?" or "is X connected?".',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ListInput,
  outputSchema: ListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('integration.connector.list requires httpClient');
    }
    return client.get<z.infer<typeof ListOutput>>('/integrations/connectors');
  },
};

// ---------- integration.connector.connect_start ----------

const ConnectStartInput = z.object({
  connectorId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe(
      'Catalog id of the connector to connect, e.g. "slack". Use ' +
        'integration.connector.list to discover ids.',
    ),
});

const ConnectStartOutput = z.object({
  provisioned: z.boolean(),
  connectorId: z.string(),
  authorizeUrl: z.string().optional(),
  stateExpiresAt: z.string().optional(),
  reason: z.string().optional(),
});

export const integrationConnectorConnectStartTool: PersonaToolDescriptor<
  typeof ConnectStartInput,
  typeof ConnectStartOutput
> = {
  id: 'integration.connector.connect_start',
  name: 'Start connecting an external integration',
  description:
    'Mint the provider authorization link for connecting an external tool ' +
    '(e.g. Slack) to this workspace. Returns ONLY a URL the owner must ' +
    'open and approve themselves — consent, token exchange and storage ' +
    'happen outside the brain. Honest { provisioned:false, reason } when ' +
    'the provider is not configured on this server. Read-only.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ConnectStartInput,
  outputSchema: ConnectStartOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error(
        'integration.connector.connect_start requires httpClient',
      );
    }
    return client.post<z.infer<typeof ConnectStartOutput>>(
      `/integrations/connectors/${input.connectorId}/connect/start`,
      {},
    );
  },
};

// ---------- integration.connector.invoke ----------

const InvokeInput = z.object({
  connectorId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe(
      'Catalog id of the connector to invoke, e.g. "slack", "github", ' +
        '"google-drive". Use integration.connector.list to discover ids.',
    ),
  action: z
    .string()
    .min(1)
    .max(128)
    .describe(
      'Action id declared by the connector, e.g. "sync.pull", ' +
        '"message.post". Unknown actions are refused with the available list.',
    ),
  input: z
    .record(z.unknown())
    .optional()
    .describe('Action-specific payload, validated downstream.'),
});

const InvokeOutput = z.object({
  ok: z.boolean(),
  invoked: z.boolean(),
  connected: z.boolean(),
  provisioned: z.boolean(),
  connectorId: z.string(),
  action: z.string().optional(),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export const integrationConnectorInvokeTool: PersonaToolDescriptor<
  typeof InvokeInput,
  typeof InvokeOutput
> = {
  id: 'integration.connector.invoke',
  name: 'Invoke an external integration action',
  description:
    'Run an action on a connected external tool/platform through the ' +
    'governed integration fabric (e.g. pull the latest Slack/Jira/CRM data, ' +
    'post a Slack message, send a WhatsApp message). HIGH-risk: data ' +
    'crosses the estate boundary — requires authorization. Returns an ' +
    'honest { connected:false, reason } envelope when the tenant has not ' +
    'connected the tool, and { provisioned:false, reason } when the runtime ' +
    'is not configured. Never fabricates data.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: InvokeInput,
  outputSchema: InvokeOutput,
  stakes: 'HIGH',
  isWrite: true,
  // Egress write to an external SaaS — must hit literal policy rules; no
  // reason-resolver generalisation (CLAUDE.md hard rule).
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('integration.connector.invoke requires httpClient');
    }
    return client.post<z.infer<typeof InvokeOutput>>(
      `/integrations/connectors/${input.connectorId}/invoke`,
      {
        action: input.action,
        ...(input.input !== undefined ? { input: input.input } : {}),
      },
    );
  },
};

export const INTEGRATION_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  integrationConnectorListTool,
  integrationConnectorConnectStartTool,
  integrationConnectorInvokeTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
