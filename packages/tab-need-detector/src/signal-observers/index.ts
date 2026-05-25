/**
 * Piece O — Signal observers barrel.
 *
 * Each observer is a pure function that converts an event into zero or
 * more `NewSignalInput`s. Callers (the cron or the API gateway middleware
 * that ingests events) compose them.
 */

export {
  observeConversation,
  type ConversationEvent,
} from './conversation-observer.js';
export {
  observeDocument,
  type DocumentExtractionEvent,
} from './document-observer.js';
export {
  observeTabEventPattern,
  type TabEventPatternEvent,
} from './tab-event-observer.js';
export {
  observeSearch,
  tokeniseQuery,
  type SearchQueryEvent,
} from './search-observer.js';
