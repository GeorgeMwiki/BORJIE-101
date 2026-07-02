/**
 * Standalone event-name constants for the two superpower CustomEvents
 * that bridge `home-chat/SuperpowerChips` (dispatcher) to
 * `SuperpowerListeners` (receiver).
 *
 * Extracted into their own leaf module so the receiver island can import
 * the names WITHOUT pulling in `SuperpowerChips`' heavy transitive deps
 * (the pino-backed sentry sink, gateway-fetch, supabase client). Both
 * sides import from here so the wire name can never drift.
 */

export const FORM_PREFILL_EVENT_NAME = 'borjie:form-prefill';
export const HIGHLIGHT_EVENT_NAME = 'borjie:highlight';
