/**
 * @borjie/api-sdk — public entry.
 *
 * Re-exports:
 *   - `createBorjieClient` and friends from `./client`
 *   - The OpenAPI-generated `paths`, `components`, `operations` types
 */

export {
  createBorjieClient,
  ApiSdkError,
  buildUrl,
  parseErrorResponse,
  type BorjieClient,
  type BorjieClientConfig,
  type ApiSdkErrorPayload,
  type HttpMethod,
  type RequestArgs,
  type PathKeys,
} from './client.js';

export type { paths, components, operations, webhooks } from './types.js';

// Per-user Jarvis client — typed POST helpers for the central-
// intelligence sovereign-AI surfaces (one per user type).
export {
  createJarvisClient,
  type JarvisSurface,
  type JarvisSurfaceClient,
  type JarvisTier,
  type JarvisStakes,
  type JarvisSeverity,
  type JarvisApprovalStatus,
  type JarvisAttachment,
  type JarvisThinkRequest,
  type JarvisThinkResponse,
  type JarvisDecision,
  type JarvisBriefing,
  type JarvisBriefingDataPoint,
  type JarvisBriefingRequest,
  type JarvisBriefingResponse,
  type JarvisProposeActionRequest,
  type JarvisApprovalRecord,
  type JarvisApprovalSignature,
  type JarvisSignRequest,
  type JarvisRecordFeedbackRequest,
  type FeedbackSignal,
  type FeedbackCategory,
} from './jarvis-client.js';

// Per-user Jarvis streaming — SSE channel for the same surfaces as
// `createJarvisClient`. Additive to the single-shot `think()` method.
export {
  createJarvisStream,
  parseSseBlock,
  translateEvent,
  type JarvisStreamEvent,
  type JarvisStreamHandle,
  type JarvisStreamPersona,
  type JarvisStreamConfidence,
  type JarvisStreamGateVerdict,
  type JarvisStreamUiPart,
} from './jarvis-stream.js';
