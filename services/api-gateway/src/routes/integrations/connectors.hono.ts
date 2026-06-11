/**
 * /api/v1/integrations/connectors — the universal integration fabric route.
 *
 * The single reachability surface for the 21 dormant connector packages
 * (`packages/connectors/<id>/`). The route is GENERIC: it dispatches over
 * the declarative `CONNECTOR_CATALOG` + `createConnectorFabric`
 * (composition/connector-fabric.ts), so a 22nd connector needs ZERO new
 * route code — just a catalog entry.
 *
 *   GET  /                       → catalog + this tenant's connection state
 *   GET  /:connectorId/status    → one connector's lifecycle status
 *   POST /:connectorId/invoke    → run a declared action ({ action, input })
 *
 * HONEST DEGRADATION (mirrors mining/legacy-portal.hono.ts — never fake
 * data, never crash):
 *   - tenant not connected   → 200 `{ ok:false, connected:false, reason }`
 *   - invoker not provisioned→ 200 `{ ok:false, provisioned:false, reason }`
 *   - unknown connector      → 404 structured error
 *   - unknown action         → 400 with the available action ids
 *   - invoker failure        → 502 structured error (message only)
 *
 * GOVERNANCE: write invocations originate from the brain tool
 * `integration.connector.invoke` (HIGH stakes, isWrite,
 * requiresPolicyRuleLiteral) so they flow through the autonomy gate +
 * policy rails before this route is reached. Direct API calls are
 * auth-gated + tenant-scoped here.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth.js';
import { databaseMiddleware } from '../../middleware/database.js';
import {
  createConnectorFabric,
  type ConnectorInvokerMap,
  type FabricDb,
} from '../../composition/connector-fabric.js';

const ConnectorIdParam = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'connectorId must be kebab-case');

const InvokeInput = z.object({
  action: z.string().min(1).max(128),
  input: z.record(z.unknown()).optional(),
});

interface AuthContext {
  readonly tenantId?: string;
  readonly userId?: string;
}

const unauthorized = {
  success: false as const,
  error: { code: 'NO_TENANT', message: 'tenant scope required' },
};

export function createConnectorsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  const fabricFor = (c: {
    get(key: string): unknown;
  }): ReturnType<typeof createConnectorFabric> => {
    const db = (c.get('db') ?? null) as FabricDb | null;
    const services = (c.get('services') ?? {}) as {
      connectorInvokers?: ConnectorInvokerMap;
    };
    return createConnectorFabric({
      db,
      ...(services.connectorInvokers !== undefined && {
        invokers: services.connectorInvokers,
      }),
    });
  };

  // ── GET / — catalog + per-tenant connection state ──────────────────
  app.get('/', async (c) => {
    const auth = (c.get('auth') ?? {}) as AuthContext;
    if (!auth.tenantId) return c.json(unauthorized, 401);

    const fabric = fabricFor(c);
    const connectors = await fabric.list(auth.tenantId);
    return c.json(
      {
        success: true as const,
        data: { connectors, total: connectors.length },
      },
      200,
    );
  });

  // ── GET /:connectorId/status — lifecycle status ────────────────────
  app.get('/:connectorId/status', async (c) => {
    const auth = (c.get('auth') ?? {}) as AuthContext;
    if (!auth.tenantId) return c.json(unauthorized, 401);

    const idParsed = ConnectorIdParam.safeParse(c.req.param('connectorId'));
    if (!idParsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_CONNECTOR_ID', message: idParsed.error.issues[0]?.message ?? 'invalid connectorId' },
        },
        400,
      );
    }

    const fabric = fabricFor(c);
    const status = await fabric.status(auth.tenantId, idParsed.data);
    if (!status) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'UNKNOWN_CONNECTOR',
            message: `no connector "${idParsed.data}" in the catalog`,
          },
        },
        404,
      );
    }
    return c.json({ success: true as const, data: status }, 200);
  });

  // ── POST /:connectorId/invoke — generic governed dispatch ──────────
  app.post('/:connectorId/invoke', async (c) => {
    const auth = (c.get('auth') ?? {}) as AuthContext;
    if (!auth.tenantId) return c.json(unauthorized, 401);

    const idParsed = ConnectorIdParam.safeParse(c.req.param('connectorId'));
    if (!idParsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_CONNECTOR_ID', message: idParsed.error.issues[0]?.message ?? 'invalid connectorId' },
        },
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_JSON', message: 'body must be JSON' },
        },
        400,
      );
    }
    const parsed = InvokeInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'BAD_INPUT',
            message: parsed.error.issues[0]?.message ?? 'invalid input',
          },
        },
        400,
      );
    }

    const fabric = fabricFor(c);
    const outcome = await fabric.invoke({
      tenantId: auth.tenantId,
      actorId: auth.userId ?? 'unknown',
      connectorId: idParsed.data,
      action: parsed.data.action,
      input: parsed.data.input ?? {},
    });

    switch (outcome.kind) {
      case 'unknown_connector':
        return c.json(
          {
            success: false as const,
            error: {
              code: 'UNKNOWN_CONNECTOR',
              message: `no connector "${outcome.connectorId}" in the catalog`,
            },
          },
          404,
        );
      case 'unknown_action':
        return c.json(
          {
            success: false as const,
            error: {
              code: 'UNKNOWN_ACTION',
              message:
                `connector "${outcome.connectorId}" has no action ` +
                `"${outcome.action}" — available: ${outcome.availableActions.join(', ')}`,
            },
          },
          400,
        );
      case 'not_connected':
        // HONEST envelope — the structured "not connected" answer the
        // brain can narrate. 200 because the fabric itself worked.
        return c.json(
          {
            success: true as const,
            data: {
              ok: false,
              invoked: false,
              connected: false,
              provisioned: false,
              connectorId: outcome.connectorId,
              reason: outcome.reason,
            },
          },
          200,
        );
      case 'not_provisioned':
        return c.json(
          {
            success: true as const,
            data: {
              ok: false,
              invoked: false,
              connected: outcome.connected,
              provisioned: false,
              connectorId: outcome.connectorId,
              reason: outcome.reason,
            },
          },
          200,
        );
      case 'invoker_error':
        return c.json(
          {
            success: false as const,
            error: {
              code: 'CONNECTOR_INVOKE_FAILED',
              message: outcome.reason,
            },
          },
          502,
        );
      case 'ok':
        return c.json(
          {
            success: true as const,
            data: {
              ok: true,
              invoked: true,
              connected: true,
              provisioned: true,
              connectorId: outcome.connectorId,
              action: outcome.action,
              result: outcome.data ?? null,
            },
          },
          200,
        );
    }
  });

  return app;
}

export default createConnectorsRouter;
