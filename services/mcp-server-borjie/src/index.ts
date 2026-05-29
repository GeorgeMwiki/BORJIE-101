/**
 * @borjie/mcp-server-borjie — public entry point.
 *
 * Exposes every MCP 2024-11-05 primitive plus four computer-use-style
 * semantic actions, per-scope rate limiting, four-eye approval for
 * sovereign tools, persistent session resume/checkpoint, server-pushed
 * progress + log events, resource subscriptions, sampling fan-out to the
 * client LLM, and a workspace mirror of the owner cockpit.
 */

export type {
  BorjieScope,
  BorjieMcpAuthContext,
  BorjieMcpToolDescriptor,
  BorjieMcpJsonSchema,
  BorjieMcpJsonProperty,
  BorjieMcpResource,
  BorjieMcpResourceContent,
  BorjieMcpPrompt,
  BorjieMcpPromptArgument,
  BorjieMcpPromptMessage,
  BorjieMcpToolSuccess,
  BorjieMcpToolFailure,
  BorjieMcpToolResult,
  BorjieMcpToolContentBlock,
  BorjieMcpProvenance,
} from './types.js';

export { BORJIE_SCOPES } from './types.js';

export {
  BORJIE_SCOPE_CATALOG,
  grantableScopesForOwner,
  hasRequiredScopes,
  type BorjieScopeDescriptor,
} from './scopes.js';

export {
  BORJIE_PUBLIC_MCP_TOOLS,
  findPublicTool,
} from './tool-catalog.js';

export {
  BORJIE_PUBLIC_MCP_RESOURCES,
  findResource,
} from './resources.js';

export {
  BORJIE_PUBLIC_MCP_PROMPTS,
  findPrompt,
  renderPrompt,
} from './prompts.js';

export {
  TOOL_ROUTE_MAP,
  substitutePath,
  shapeRequest,
  type ToolRoute,
  type ShapedRequest,
} from './tool-router.js';

export {
  createGatewayClient,
  buildGatewayUrl,
  GatewayError,
  type GatewayClient,
  type GatewayClientConfig,
  type GatewayCallInput,
} from './gateway-client.js';

export {
  createDispatcher,
  type DispatcherDeps,
  type DispatcherInput,
} from './dispatcher.js';

export {
  createHttpHandler,
  type HttpHandlerDeps,
  type HttpRequestLike,
  type HttpResponseLike,
} from './transports/http.js';

export { runStdio, type StdioOptions } from './transports/stdio.js';

export {
  createSseHandler,
  createInMemorySseRegistry,
  formatSseEvent,
  type SseHandlerDeps,
  type SseChannel,
  type SseEvent,
  type SseConnectInput,
  type SsePostInput,
  type SseSessionRegistry,
} from './transports/sse.js';

export {
  buildManifest,
  type BorjieMcpManifest,
  type ManifestOptions,
} from './manifest.js';

export {
  isJsonRpcRequest,
  parseJsonRpcLine,
  buildSuccess,
  buildError,
  buildNotification,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_UNAUTHORIZED,
  JSON_RPC_FORBIDDEN,
  JSON_RPC_KILL_SWITCH_OPEN,
  JSON_RPC_SAMPLING_UNSUPPORTED,
  JSON_RPC_APPROVAL_PENDING,
  JSON_RPC_APPROVAL_DENIED,
  JSON_RPC_APPROVAL_EXPIRED,
  JSON_RPC_RATE_LIMIT_EXCEEDED,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
  type JsonRpcError,
  type JsonRpcNotification,
} from './jsonrpc.js';

export {
  type LogLevel,
  type LogMessage,
  type LogSink,
  type LogLevelController,
  LOG_LEVEL_RANK,
  ALL_LOG_LEVELS,
  createMemoryLogSink,
  createLogLevelController,
  shouldEmit,
  isValidLogLevel,
} from './logging.js';

export {
  type NotificationSink,
  type ProgressNotification,
  type ToolProgressEmitter,
  createNoopNotificationSink,
  createMemoryNotificationSink,
  createToolProgressEmitter,
  extractProgressToken,
} from './progress.js';

export {
  samplingCreateMessageRequestSchema,
  createEchoSamplingResponder,
  createUnsupportedSamplingResponder,
  SamplingUnsupportedError,
  type SamplingResponder,
  type SamplingCreateMessageRequest,
  type SamplingCreateMessageResponse,
} from './sampling.js';

export {
  rootSchema,
  createStaticRootsProvider,
  createEmptyRootsProvider,
  createMutableRootsProvider,
  type Root,
  type RootsProvider,
} from './roots.js';

export {
  createInMemorySubscriptionRegistry,
  assertSubscribableResource,
  UnknownResourceSubscriptionError,
  type ResourceSubscription,
  type SubscriptionRegistry,
} from './subscriptions.js';

export {
  RATE_LIMIT_EXCEEDED_CODE,
  DEFAULT_RATE_LIMITS,
  createTokenBucketRateLimiter,
  type RateLimitDecision,
  type RateLimitConfig,
  type RateLimiter,
  type RateLimiterOptions,
} from './rate-limit.js';

export {
  navigateSchema,
  prefillSchema,
  shareSchema,
  undoSchema,
  createEchoActionsHandler,
  summariseAction,
  type NavigateInput,
  type PrefillInput,
  type ShareInput,
  type UndoInput,
  type ActionResult,
  type ActionsHandler,
} from './actions.js';

export {
  createInMemorySessionStore,
  createSessionManager,
  type SessionTurn,
  type SessionSnapshot,
  type SessionStore,
  type SessionManager,
  type SessionCheckpointDeps,
} from './sessions.js';

export {
  FOUR_EYE_PREFIXES,
  requiresFourEye,
  createInMemoryApprovalStore,
  buildPendingApprovalResponse,
  type ApprovalStatus,
  type ActionApproval,
  type ApprovalStore,
  type PendingApprovalResponse,
} from './four-eye.js';

export {
  workspaceStateSchema,
  workspaceTabSchema,
  workspaceReminderSchema,
  workspacePinSchema,
  createEmptyWorkspaceProvider,
  type WorkspaceState,
  type WorkspaceTab,
  type WorkspaceReminder,
  type WorkspacePin,
  type WorkspaceProvider,
} from './workspace.js';
