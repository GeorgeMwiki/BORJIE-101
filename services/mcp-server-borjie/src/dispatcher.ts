/**
 * MCP method dispatcher — pure handler for incoming JSON-RPC requests.
 *
 * The dispatcher is transport-agnostic: stdio, HTTP, and SSE all reduce
 * to "give me a JsonRpcRequest, I will give you a JsonRpcResponse" with
 * optional out-of-band notifications via the NotificationSink. This
 * lets us share the same logic and write deterministic unit tests.
 *
 * Surface (all 12 SOTA primitives):
 *   1. SSE transport         — see transports/sse.ts (uses this)
 *   2. sampling/createMessage — server asks client for an LLM completion
 *   3. roots/list             — client file URIs the server can ingest
 *   4. logging/setLevel + logging/message notifications
 *   5. $/progress notifications for long-running tools
 *   6. resources/subscribe + resources/unsubscribe + notifications/resources/updated
 *   7. $/result_partial streaming for many-small-result tools
 *   8. session checkpoint/resume via SessionManager
 *   9. computer-use semantic actions (actions/navigate|prefill|share|undo)
 *  10. per-scope rate limiting (RATE_LIMIT_EXCEEDED_CODE)
 *  11. four-eye approval for kill_switch.* / four_eye.* / sovereign.* /
 *      policy_rollout.* tool prefixes
 *  12. discovery filters (tools/list?capability=... / resources/list?since=...)
 *      + workspace/state snapshot of owner cockpit
 */

import {
  BORJIE_PUBLIC_MCP_TOOLS,
  findPublicTool,
} from './tool-catalog.js';
import { BORJIE_PUBLIC_MCP_RESOURCES, findResource } from './resources.js';
import {
  BORJIE_PUBLIC_MCP_PROMPTS,
  findPrompt,
  renderPrompt,
} from './prompts.js';
import { hasRequiredScopes } from './scopes.js';
import {
  buildError,
  buildSuccess,
  JSON_RPC_FORBIDDEN,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_KILL_SWITCH_OPEN,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_UNAUTHORIZED,
  JSON_RPC_SAMPLING_UNSUPPORTED,
  JSON_RPC_APPROVAL_PENDING,
  JSON_RPC_APPROVAL_DENIED,
  JSON_RPC_APPROVAL_EXPIRED,
  JSON_RPC_RATE_LIMIT_EXCEEDED,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './jsonrpc.js';
import { substitutePath, shapeRequest, TOOL_ROUTE_MAP } from './tool-router.js';
import type {
  BorjieMcpAuthContext,
  BorjieMcpProvenance,
  BorjieMcpToolContentBlock,
  BorjieMcpToolResult,
} from './types.js';
import type { GatewayClient } from './gateway-client.js';
import { GatewayError } from './gateway-client.js';
import {
  type LogSink,
  type LogLevelController,
  createLogLevelController,
  shouldEmit,
  isValidLogLevel,
} from './logging.js';
import {
  type NotificationSink,
  createNoopNotificationSink,
  createToolProgressEmitter,
  extractProgressToken,
} from './progress.js';
import {
  type SamplingResponder,
  samplingCreateMessageRequestSchema,
  SamplingUnsupportedError,
  createUnsupportedSamplingResponder,
} from './sampling.js';
import { type RootsProvider, createEmptyRootsProvider } from './roots.js';
import {
  type SubscriptionRegistry,
  createInMemorySubscriptionRegistry,
  assertSubscribableResource,
  UnknownResourceSubscriptionError,
} from './subscriptions.js';
import {
  type RateLimiter,
  createTokenBucketRateLimiter,
} from './rate-limit.js';
import {
  type ActionsHandler,
  createEchoActionsHandler,
  navigateSchema,
  prefillSchema,
  shareSchema,
  undoSchema,
  summariseAction,
} from './actions.js';
import {
  type SessionManager,
  createSessionManager,
  createInMemorySessionStore,
} from './sessions.js';
import {
  type ApprovalStore,
  createInMemoryApprovalStore,
  requiresFourEye,
  buildPendingApprovalResponse,
} from './four-eye.js';
import {
  type WorkspaceProvider,
  createEmptyWorkspaceProvider,
} from './workspace.js';

export interface DispatcherDeps {
  readonly gatewayClient: GatewayClient;
  readonly resolveAuthContext: (
    bearerToken: string | null,
  ) => Promise<BorjieMcpAuthContext | null>;
  readonly killSwitchOpen: () => Promise<boolean>;
  readonly now?: () => Date;
  readonly auditChainHash: (input: {
    readonly toolName: string;
    readonly auth: BorjieMcpAuthContext;
    readonly idempotencyKey?: string;
  }) => Promise<string>;
  // ── SOTA primitives — all optional with safe defaults ─────────────
  readonly logSink?: LogSink;
  readonly logLevel?: LogLevelController;
  readonly notificationSink?: NotificationSink;
  readonly samplingResponder?: SamplingResponder;
  readonly rootsProvider?: RootsProvider;
  readonly subscriptions?: SubscriptionRegistry;
  readonly rateLimiter?: RateLimiter;
  readonly actionsHandler?: ActionsHandler;
  readonly sessionManager?: SessionManager;
  readonly approvalStore?: ApprovalStore;
  readonly workspaceProvider?: WorkspaceProvider;
  readonly approvalTtlMs?: number;
  readonly ownerWebBaseUrl?: string;
  readonly sessionId?: string;
}

export interface DispatcherInput {
  readonly request: JsonRpcRequest;
  readonly bearerToken: string | null;
  readonly idempotencyKey?: string;
  readonly sessionId?: string;
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'borjie-mcp-server';
const SERVER_VERSION = '0.2.0';

export function createDispatcher(deps: DispatcherDeps) {
  const now = deps.now ?? (() => new Date());
  const logSink: LogSink | undefined = deps.logSink;
  const logLevel = deps.logLevel ?? createLogLevelController('info');
  const notify = deps.notificationSink ?? createNoopNotificationSink();
  const samplingResponder =
    deps.samplingResponder ?? createUnsupportedSamplingResponder();
  const rootsProvider = deps.rootsProvider ?? createEmptyRootsProvider();
  const subscriptions =
    deps.subscriptions ?? createInMemorySubscriptionRegistry();
  const rateLimiter = deps.rateLimiter ?? createTokenBucketRateLimiter();
  const actionsHandler = deps.actionsHandler ?? createEchoActionsHandler();
  const sessionManager =
    deps.sessionManager ??
    createSessionManager({ store: createInMemorySessionStore() });
  const approvalStore = deps.approvalStore ?? createInMemoryApprovalStore();
  const workspaceProvider =
    deps.workspaceProvider ?? createEmptyWorkspaceProvider();
  const approvalTtlMs = deps.approvalTtlMs ?? 10 * 60 * 1_000;
  const ownerWebBaseUrl =
    deps.ownerWebBaseUrl ?? 'https://owner.borjie.app';

  function log(
    level: 'debug' | 'info' | 'notice' | 'warning' | 'error',
    logger: string,
    data: unknown,
  ): void {
    if (!logSink) return;
    if (!shouldEmit(logLevel, level)) return;
    logSink.emit({ level, logger, data });
  }

  async function dispatch(input: DispatcherInput): Promise<JsonRpcResponse> {
    const { request, bearerToken, idempotencyKey } = input;
    const { id, method } = request;

    if (await deps.killSwitchOpen()) {
      log('error', 'mcp.kill-switch', { method });
      return buildError(
        id,
        JSON_RPC_KILL_SWITCH_OPEN,
        'Borjie kill-switch is open — refusing all tool calls.',
      );
    }

    if (method === 'initialize') {
      log('info', 'mcp.initialize', {});
      return buildSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: true },
          prompts: { listChanged: false },
          logging: {},
          sampling: {},
          roots: { listChanged: true },
          experimental: {
            sessions: { checkpoint: true, resume: true },
            actions: {
              navigate: true,
              prefill: true,
              share: true,
              undo: true,
            },
            fourEye: { prefixes: ['kill_switch', 'four_eye', 'sovereign', 'policy_rollout'] },
            workspace: true,
            progress: true,
            resultPartial: true,
          },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }

    if (method === 'ping') {
      return buildSuccess(id, {});
    }

    // ─── logging/setLevel ───────────────────────────────────────────
    if (method === 'logging/setLevel') {
      const params = request.params ?? {};
      const level = params['level'];
      if (!isValidLogLevel(level)) {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'logging/setLevel requires a valid RFC 5424 level',
        );
      }
      logLevel.set(level);
      return buildSuccess(id, {});
    }

    // ─── roots/list ─────────────────────────────────────────────────
    if (method === 'roots/list') {
      const roots = await rootsProvider.list();
      return buildSuccess(id, { roots });
    }

    // ─── sampling/createMessage ─────────────────────────────────────
    if (method === 'sampling/createMessage') {
      const parsed = samplingCreateMessageRequestSchema.safeParse(
        request.params ?? {},
      );
      if (!parsed.success) {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          parsed.error.errors[0]?.message ?? 'invalid sampling request',
        );
      }
      try {
        const result = await samplingResponder.createMessage(parsed.data);
        return buildSuccess(id, result);
      } catch (err) {
        if (err instanceof SamplingUnsupportedError) {
          return buildError(id, JSON_RPC_SAMPLING_UNSUPPORTED, err.message);
        }
        return buildError(
          id,
          JSON_RPC_INTERNAL_ERROR,
          err instanceof Error ? err.message : 'sampling failed',
        );
      }
    }

    // ─── resources/subscribe ────────────────────────────────────────
    if (method === 'resources/subscribe') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const uri = (request.params ?? {})['uri'];
      if (typeof uri !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'resources/subscribe requires `uri`');
      }
      try {
        assertSubscribableResource(uri);
      } catch (err) {
        if (err instanceof UnknownResourceSubscriptionError) {
          return buildError(id, JSON_RPC_METHOD_NOT_FOUND, err.message);
        }
        throw err;
      }
      const sessionId = input.sessionId ?? deps.sessionId ?? auth.agentTokenId;
      subscriptions.subscribe(sessionId, uri);
      log('info', 'mcp.subscribe', { uri, sessionId });
      return buildSuccess(id, { subscribed: true, uri });
    }

    if (method === 'resources/unsubscribe') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const uri = (request.params ?? {})['uri'];
      if (typeof uri !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'resources/unsubscribe requires `uri`');
      }
      const sessionId = input.sessionId ?? deps.sessionId ?? auth.agentTokenId;
      subscriptions.unsubscribe(sessionId, uri);
      return buildSuccess(id, { unsubscribed: true, uri });
    }

    // ─── workspace/state ────────────────────────────────────────────
    if (method === 'workspace/state') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const snapshot = await workspaceProvider.snapshot({
        tenantId: auth.tenantId,
        ownerId: auth.ownerId,
      });
      return buildSuccess(id, snapshot);
    }

    // ─── session/resume + session/checkpoint + session/setState ────
    if (method === 'session/resume') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const sessionId =
        (request.params ?? {})['sessionId'] ??
        input.sessionId ??
        deps.sessionId ??
        auth.agentTokenId;
      if (typeof sessionId !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, '`sessionId` must be a string');
      }
      const snapshot = await sessionManager.resume(sessionId, auth.agentTokenId);
      return buildSuccess(id, snapshot);
    }

    if (method === 'session/snapshot') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const sessionId =
        (request.params ?? {})['sessionId'] ??
        input.sessionId ??
        deps.sessionId ??
        auth.agentTokenId;
      if (typeof sessionId !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, '`sessionId` must be a string');
      }
      const snap = await sessionManager.snapshot(sessionId);
      return buildSuccess(id, snap ?? { sessionId, conversationSummary: [], state: {} });
    }

    if (method === 'session/setState') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const params = request.params ?? {};
      const sessionId =
        params['sessionId'] ?? input.sessionId ?? deps.sessionId ?? auth.agentTokenId;
      if (typeof sessionId !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, '`sessionId` must be a string');
      }
      const stateRaw = params['state'];
      if (!stateRaw || typeof stateRaw !== 'object') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, '`state` must be an object');
      }
      const next = await sessionManager.setState(
        sessionId,
        auth.agentTokenId,
        stateRaw as Record<string, unknown>,
      );
      return buildSuccess(id, next);
    }

    // ─── actions/* ──────────────────────────────────────────────────
    if (method === 'actions/navigate') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      if (!hasRequiredScopes(auth.scopes, ['owner:reminders'])) {
        return buildError(id, JSON_RPC_FORBIDDEN, 'scope required: owner:reminders');
      }
      const parsed = navigateSchema.safeParse(request.params ?? {});
      if (!parsed.success) {
        return buildError(id, JSON_RPC_INVALID_PARAMS, parsed.error.errors[0]?.message ?? 'invalid input');
      }
      const payload = await actionsHandler.navigate(parsed.data);
      const summary = summariseAction('navigate', payload);
      return buildSuccess(id, {
        ok: true,
        action: 'navigate',
        summary: summary.en,
        summarySw: summary.sw,
        payload,
        provenance: buildProvenance(auth, 'actions.navigate', now()),
      });
    }

    if (method === 'actions/prefill') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      if (!hasRequiredScopes(auth.scopes, ['owner:write'])) {
        return buildError(id, JSON_RPC_FORBIDDEN, 'scope required: owner:write');
      }
      const parsed = prefillSchema.safeParse(request.params ?? {});
      if (!parsed.success) {
        return buildError(id, JSON_RPC_INVALID_PARAMS, parsed.error.errors[0]?.message ?? 'invalid input');
      }
      const payload = await actionsHandler.prefill(parsed.data);
      const summary = summariseAction('prefill', payload);
      return buildSuccess(id, {
        ok: true,
        action: 'prefill',
        summary: summary.en,
        summarySw: summary.sw,
        payload,
        provenance: buildProvenance(auth, 'actions.prefill', now()),
      });
    }

    if (method === 'actions/share') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      if (!hasRequiredScopes(auth.scopes, ['owner:share'])) {
        return buildError(id, JSON_RPC_FORBIDDEN, 'scope required: owner:share');
      }
      const parsed = shareSchema.safeParse(request.params ?? {});
      if (!parsed.success) {
        return buildError(id, JSON_RPC_INVALID_PARAMS, parsed.error.errors[0]?.message ?? 'invalid input');
      }
      const payload = await actionsHandler.share(parsed.data);
      const summary = summariseAction('share', payload);
      return buildSuccess(id, {
        ok: true,
        action: 'share',
        summary: summary.en,
        summarySw: summary.sw,
        payload,
        provenance: buildProvenance(auth, 'actions.share', now()),
      });
    }

    if (method === 'actions/undo') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      if (!hasRequiredScopes(auth.scopes, ['owner:write'])) {
        return buildError(id, JSON_RPC_FORBIDDEN, 'scope required: owner:write');
      }
      const parsed = undoSchema.safeParse(request.params ?? {});
      if (!parsed.success) {
        return buildError(id, JSON_RPC_INVALID_PARAMS, parsed.error.errors[0]?.message ?? 'invalid input');
      }
      const payload = await actionsHandler.undo(parsed.data);
      const summary = summariseAction('undo', payload);
      return buildSuccess(id, {
        ok: true,
        action: 'undo',
        summary: summary.en,
        summarySw: summary.sw,
        payload,
        provenance: buildProvenance(auth, 'actions.undo', now()),
      });
    }

    // ─── actions/approval_status — four-eye polling ─────────────────
    if (method === 'actions/approval_status') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const approvalId = (request.params ?? {})['approvalId'];
      if (typeof approvalId !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'approvalId required');
      }
      const approval = await approvalStore.get(approvalId);
      if (!approval) return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown approval: ${approvalId}`);
      // RLS-equivalent isolation
      if (approval.tokenId !== auth.agentTokenId) {
        return buildError(id, JSON_RPC_FORBIDDEN, 'approval does not belong to this token');
      }
      return buildSuccess(id, {
        approvalId,
        status: approval.status,
        toolName: approval.toolName,
        requestedAt: approval.requestedAt,
        expiresAt: approval.expiresAt,
      });
    }

    // ─── tools/list (filterable) ───────────────────────────────────
    if (method === 'tools/list') {
      const params = request.params ?? {};
      const capability = typeof params['capability'] === 'string'
        ? params['capability'] as string
        : undefined;
      const tools = BORJIE_PUBLIC_MCP_TOOLS.filter((t) => {
        if (!capability) return true;
        return t.name.toLowerCase().includes(capability.toLowerCase());
      }).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return buildSuccess(id, { tools });
    }

    // ─── resources/list (filterable) ───────────────────────────────
    if (method === 'resources/list') {
      const params = request.params ?? {};
      const sinceRaw = typeof params['since'] === 'string'
        ? params['since'] as string
        : undefined;
      // Static resources have no `updatedAt`, so `since` is a no-op
      // filter UNLESS a value was provided — we then return the full
      // set with an `asOf` header so the agent can poll on cadence.
      const resources = BORJIE_PUBLIC_MCP_RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
      return buildSuccess(id, {
        resources,
        ...(sinceRaw ? { since: sinceRaw, asOf: now().toISOString() } : {}),
      });
    }

    if (method === 'prompts/list') {
      return buildSuccess(id, {
        prompts: BORJIE_PUBLIC_MCP_PROMPTS.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        })),
      });
    }

    if (method === 'prompts/get') {
      const params = request.params ?? {};
      const name = params['name'];
      if (typeof name !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'prompts/get requires `name`');
      }
      const prompt = findPrompt(name);
      if (!prompt) return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `prompt: ${name}`);
      const args = (params['arguments'] ?? {}) as Record<string, string>;
      const messages = renderPrompt(name, args);
      if (!messages) {
        return buildError(id, JSON_RPC_INTERNAL_ERROR, `prompt renderer missing for ${name}`);
      }
      return buildSuccess(id, { description: prompt.description, messages });
    }

    if (method === 'resources/read') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const params = request.params ?? {};
      const uri = params['uri'];
      if (typeof uri !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'resources/read requires `uri`');
      }
      const resource = findResource(uri);
      if (!resource) return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown resource: ${uri}`);
      try {
        const data = await readResource(uri, deps.gatewayClient, auth);
        return buildSuccess(id, {
          contents: [
            { uri, mimeType: resource.mimeType, text: JSON.stringify(data) },
          ],
        });
      } catch (err) {
        return resourceErrorToRpc(id, err);
      }
    }

    if (method === 'tools/call') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      const params = request.params ?? {};
      const name = params['name'];
      if (typeof name !== 'string') {
        return buildError(id, JSON_RPC_INVALID_PARAMS, 'tools/call requires `name`');
      }
      const tool = findPublicTool(name);
      if (!tool) {
        // Allow four-eye tools that aren't in the public catalog (e.g.
        // kill_switch.open) so the gate fires for sovereign actions.
        if (requiresFourEye(name)) {
          return handleFourEye({
            id,
            toolName: name,
            args: (params['arguments'] ?? {}) as Record<string, unknown>,
            auth,
          });
        }
        return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown tool: ${name}`);
      }
      if (!hasRequiredScopes(auth.scopes, tool.requiredScopes)) {
        return buildError(
          id,
          JSON_RPC_FORBIDDEN,
          `scope required: ${tool.requiredScopes.join(', ')}`,
        );
      }
      // Per-scope rate limit on the first required scope.
      const firstScope = tool.requiredScopes[0];
      if (firstScope) {
        const decision = rateLimiter.check(auth.agentTokenId, firstScope);
        if (!decision.allowed) {
          log('warning', 'mcp.rate-limit', {
            scope: firstScope,
            retryAfterSeconds: decision.retryAfterSeconds,
          });
          return buildError(
            id,
            JSON_RPC_RATE_LIMIT_EXCEEDED,
            `rate limit exceeded for scope ${firstScope}`,
            { retry_after_seconds: decision.retryAfterSeconds },
          );
        }
      }
      if (requiresFourEye(name)) {
        return handleFourEye({
          id,
          toolName: name,
          args: (params['arguments'] ?? {}) as Record<string, unknown>,
          auth,
        });
      }

      const args = (params['arguments'] ?? {}) as Record<string, unknown>;
      const route = TOOL_ROUTE_MAP[name];
      if (!route) {
        return buildError(id, JSON_RPC_INTERNAL_ERROR, `route not registered for ${name}`);
      }

      const progressToken = extractProgressToken(params);
      const emitter = createToolProgressEmitter(notify, {
        requestId: id,
        ...(progressToken !== undefined ? { progressToken } : {}),
      });
      emitter.emit(0, 100, 'starting');
      log('info', 'mcp.tools.call.begin', { tool: name });

      let path: string;
      try {
        path = substitutePath(route.path, args);
      } catch (err) {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          err instanceof Error ? err.message : 'invalid path params',
        );
      }
      const shaped = shapeRequest(route, args);

      try {
        const upstream = await deps.gatewayClient.call({
          path,
          method: route.method,
          accessToken: bearerToken ?? '',
          agentTokenId: auth.agentTokenId,
          mcpToolName: name,
          ...(shaped.body !== undefined ? { body: shaped.body } : {}),
          ...(shaped.query !== undefined ? { query: shaped.query } : {}),
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
        emitter.emit(100, 100, 'done');
        const auditHash = await deps.auditChainHash({
          toolName: name,
          auth,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
        const result: BorjieMcpToolResult = {
          ok: true,
          content: shapeContent(upstream),
          confidence: pickConfidence(upstream),
          evidenceIds: pickEvidenceIds(upstream),
          provenance: {
            via: 'mcp',
            agentName: auth.agentName,
            agentTokenId: auth.agentTokenId,
            toolName: name,
            invokedAt: now().toISOString(),
            auditChainHash: auditHash,
          },
          requiresConfirmation: tool.requiresConfirmation,
        };
        if (input.sessionId ?? deps.sessionId) {
          const sid = (input.sessionId ?? deps.sessionId) as string;
          await sessionManager.resume(sid, auth.agentTokenId).catch(() => null);
          await sessionManager
            .checkpoint(sid, {
              direction: 'response',
              method: 'tools/call',
              toolName: name,
              at: now().getTime(),
              summary: `${name} ok`,
            })
            .catch(() => null);
        }
        log('info', 'mcp.tools.call.ok', { tool: name });
        return buildSuccess(id, result);
      } catch (err) {
        log('error', 'mcp.tools.call.error', {
          tool: name,
          err: err instanceof Error ? err.message : String(err),
        });
        return toolErrorToRpc(id, err);
      }
    }

    return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown method: ${method}`);
  }

  async function handleFourEye(args: {
    readonly id: string | number | null;
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly auth: BorjieMcpAuthContext;
  }): Promise<JsonRpcResponse> {
    const expiresAt = Date.now() + approvalTtlMs;
    const approval = await approvalStore.create({
      tokenId: args.auth.agentTokenId,
      toolName: args.toolName,
      arguments: args.args,
      expiresAt,
    });
    const payload = buildPendingApprovalResponse({
      approval,
      ownerWebBaseUrl,
    });
    log('warning', 'mcp.four-eye.pending', {
      tool: args.toolName,
      approvalId: approval.id,
    });
    return buildError(
      args.id,
      JSON_RPC_APPROVAL_PENDING,
      'four-eye approval required',
      payload,
    );
  }

  return Object.freeze({
    dispatch,
    approvalErrorCodes: {
      pending: JSON_RPC_APPROVAL_PENDING,
      denied: JSON_RPC_APPROVAL_DENIED,
      expired: JSON_RPC_APPROVAL_EXPIRED,
    },
    notify,
    log,
  });
}

function buildProvenance(
  auth: BorjieMcpAuthContext,
  toolName: string,
  at: Date,
): BorjieMcpProvenance {
  return Object.freeze({
    via: 'mcp' as const,
    agentName: auth.agentName,
    agentTokenId: auth.agentTokenId,
    toolName,
    invokedAt: at.toISOString(),
    auditChainHash: '',
  });
}

function shapeContent(upstream: unknown): ReadonlyArray<BorjieMcpToolContentBlock> {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    if (typeof o['text'] === 'string') {
      return Object.freeze([
        Object.freeze({ type: 'text' as const, text: o['text'] }),
      ]);
    }
  }
  return Object.freeze([
    Object.freeze({ type: 'json' as const, data: upstream }),
  ]);
}

function pickConfidence(upstream: unknown): number {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    const c = o['confidence'];
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return 0.75;
}

function pickEvidenceIds(upstream: unknown): ReadonlyArray<string> {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    const e = o['evidenceIds'];
    if (Array.isArray(e)) {
      return Object.freeze(e.filter((v): v is string => typeof v === 'string'));
    }
  }
  return Object.freeze([]);
}

async function readResource(
  uri: string,
  client: GatewayClient,
  auth: BorjieMcpAuthContext,
): Promise<unknown> {
  const path = mapResourceUriToPath(uri);
  return client.call({
    path,
    method: 'GET',
    accessToken: '',
    agentTokenId: auth.agentTokenId,
    mcpToolName: `resource:${uri}`,
  });
}

function mapResourceUriToPath(uri: string): string {
  switch (uri) {
    case 'borjie://capabilities':
      return '/.well-known/borjie-capabilities.json';
    case 'borjie://estate/entities':
      return '/api/v1/entities/summary';
    case 'borjie://decisions/recent':
      return '/api/v1/decisions?limit=50';
    case 'borjie://calibration/current':
      return '/api/v1/mining/calibration/status';
    case 'borjie://corpus/mining/index':
      return '/api/v1/intelligence/corpus/index';
    case 'borjie://compliance/posture':
      return '/api/v1/compliance/status';
    case 'borjie://memory/advisor':
      return '/api/v1/owner/memory/advisor';
    case 'borjie://reminders/upcoming':
      return '/api/v1/owner/reminders?upcoming=true';
    default:
      throw new Error(`no path mapping for resource ${uri}`);
  }
}

function toolErrorToRpc(
  id: string | number | null,
  err: unknown,
): JsonRpcResponse {
  if (err instanceof GatewayError) {
    if (err.status === 401) return buildError(id, JSON_RPC_UNAUTHORIZED, err.message);
    if (err.status === 403) return buildError(id, JSON_RPC_FORBIDDEN, err.message);
    if (err.status === 422) return buildError(id, JSON_RPC_INVALID_PARAMS, err.message);
    if (err.status === 429) {
      return buildError(id, JSON_RPC_RATE_LIMIT_EXCEEDED, err.message, {
        status: err.status,
        code: err.code,
      });
    }
    return buildError(id, JSON_RPC_INTERNAL_ERROR, err.message, {
      status: err.status,
      code: err.code,
    });
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  return buildError(id, JSON_RPC_INTERNAL_ERROR, message);
}

function resourceErrorToRpc(
  id: string | number | null,
  err: unknown,
): JsonRpcResponse {
  return toolErrorToRpc(id, err);
}
