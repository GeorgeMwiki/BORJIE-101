/**
 * Adaptive-thinking wrapper — barrel.
 *
 * Public surface:
 *   - createThinkingMessage(...)     — the only safe way to call
 *                                       Claude with adaptive thinking.
 *   - buildRequest / buildTelemetry  — pure helpers, exported for tests.
 *   - All types in `./types.ts`.
 */

export * from './types.js';
export {
  createThinkingMessage,
  buildRequest,
  buildTelemetry,
  type CreateThinkingMessageArgs,
  type CreateThinkingMessageResult,
} from './create-thinking-message.js';
