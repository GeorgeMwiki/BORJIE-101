/**
 * MCP `resources/subscribe` + `resources/unsubscribe` +
 * `notifications/resources/updated`.
 *
 * Per MCP 2024-11-05:
 *   - Client subscribes to a resource URI.
 *   - Server holds (session, uri) tuple in memory.
 *   - When the underlying resource changes (e.g. a new reminder lands),
 *     the server pushes `notifications/resources/updated` carrying the
 *     uri to every subscriber.
 *
 * Borjie use case: an agent subscribes to `borjie://reminders/upcoming`;
 * the reminders service emits a change event whenever a reminder is
 * created / cancelled / fired, and the api-gateway adapter fans it out
 * via this registry.
 *
 * This module owns ONLY the subscription bookkeeping — the fan-out is
 * the api-gateway adapter's job (it knows the SSE channel registry).
 */

import { findResource } from './resources.js';

export interface ResourceSubscription {
  readonly sessionId: string;
  readonly uri: string;
  readonly subscribedAt: number;
}

export interface SubscriptionRegistry {
  subscribe(sessionId: string, uri: string): void;
  unsubscribe(sessionId: string, uri: string): void;
  subscribersFor(uri: string): ReadonlyArray<string>;
  listForSession(sessionId: string): ReadonlyArray<ResourceSubscription>;
  releaseSession(sessionId: string): void;
}

/** In-memory registry. The api-gateway wraps it with a redis pub/sub. */
export function createInMemorySubscriptionRegistry(): SubscriptionRegistry {
  const byUri = new Map<string, Map<string, number>>();

  function ensureUri(uri: string): Map<string, number> {
    const existing = byUri.get(uri);
    if (existing) return existing;
    const created = new Map<string, number>();
    byUri.set(uri, created);
    return created;
  }

  const registry: SubscriptionRegistry = {
    subscribe(sessionId: string, uri: string): void {
      ensureUri(uri).set(sessionId, Date.now());
    },
    unsubscribe(sessionId: string, uri: string): void {
      const entries = byUri.get(uri);
      if (!entries) return;
      entries.delete(sessionId);
      if (entries.size === 0) byUri.delete(uri);
    },
    subscribersFor(uri: string): ReadonlyArray<string> {
      const entries = byUri.get(uri);
      if (!entries || entries.size === 0) return Object.freeze([]);
      return Object.freeze([...entries.keys()]);
    },
    listForSession(sessionId: string): ReadonlyArray<ResourceSubscription> {
      const out: ResourceSubscription[] = [];
      for (const [uri, entries] of byUri.entries()) {
        const t = entries.get(sessionId);
        if (t !== undefined) {
          out.push(Object.freeze({ sessionId, uri, subscribedAt: t }));
        }
      }
      return Object.freeze(out);
    },
    releaseSession(sessionId: string): void {
      for (const [uri, entries] of [...byUri.entries()]) {
        entries.delete(sessionId);
        if (entries.size === 0) byUri.delete(uri);
      }
    },
  };
  return Object.freeze(registry);
}

export class UnknownResourceSubscriptionError extends Error {
  constructor(uri: string) {
    super(`unknown resource for subscription: ${uri}`);
    this.name = 'UnknownResourceSubscriptionError';
  }
}

/** Validate the URI before recording the subscription. */
export function assertSubscribableResource(uri: string): void {
  if (!findResource(uri)) {
    throw new UnknownResourceSubscriptionError(uri);
  }
}
