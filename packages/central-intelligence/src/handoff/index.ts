/**
 * @borjie/central-intelligence — handoff module.
 *
 * Public surface for the cross-role knowledge-handoff chain. Imported
 * by `services/api-gateway` to wire the brain SSE parser, the route
 * handler that persists the row, and the notification dispatcher.
 *
 * The four primitives:
 *
 *   parseChatHandoffs(text)       extract `<chat_handoff />` tags
 *   createHandoffRecorder(deps)   hash-chained writer for chat_handoffs
 *   HANDOFF_PERSONA_ROLES         enum of recipient persona slugs
 *   HandoffError                  typed error code surface
 */

export {
  parseChatHandoffs,
  type ParsedChatHandoff,
  type ParseChatHandoffsResult,
} from './parser.js';
export {
  parseContextSet,
  type ContextCrumbPayload,
  type ParseContextSetResult,
} from './context-set-parser.js';
export {
  createHandoffRecorder,
  type HandoffRecorder,
  type HandoffRecorderDeps,
  type HandoffDbLike,
  type HandoffNotificationPort,
} from './recorder.js';
export {
  HANDOFF_PERSONA_ROLES,
  HANDOFF_RESOLUTIONS,
  HandoffError,
  type ChatHandoff,
  type HandoffPersonaRole,
  type HandoffResolution,
  type HandoffScopePayload,
  type RecordHandoffInput,
  type ResolveHandoffInput,
} from './types.js';
