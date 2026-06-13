/**
 * Buyer-mobile inbox — single-source-of-truth note (SLICE TZ4).
 *
 * This module used to hold a SECOND, in-memory inbox: an SSE-fed ring
 * of `InboxItem`s with its own AsyncStorage-backed read-state. That
 * parallel store could diverge from the persisted `buyer_notifications`
 * inbox — a notification could read "read" in the ribbon but "unread"
 * in the list (and vice versa).
 *
 * The inbox is now unified on the PERSISTED path:
 *   - The authoritative inbox + unread count live in the
 *     `buyer_notifications` react-query cache
 *     (see `app/notifications.tsx` + `src/api/notifications.ts`).
 *   - The cockpit SSE pulse no longer maintains a list; it only
 *     invalidates that query so the screen refetches the server record
 *     (see `EventStreamMount.tsx`).
 *
 * Only the event-kind type is re-exported here for callers that referred
 * to it via this module. There is no in-memory list or read-state.
 */

export type { BuyerEventKind } from './event-stream'
