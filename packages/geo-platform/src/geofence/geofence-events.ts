/**
 * Geofence event emitter — a tiny pub-sub the LiveMap or any other
 * caller can subscribe to. Decoupled from the engine so we never mix
 * mutable subscriber lists into the immutable engine snapshot.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §6.2.
 */

import type { GeofenceEvent, GeofenceEventKind } from '../types.js';
import { logger } from '../logger.js';

export type GeofenceEventListener = (event: GeofenceEvent) => void;
export type Unsubscribe = () => void;

interface ListenerEntry {
  readonly kind: GeofenceEventKind | 'any';
  readonly listener: GeofenceEventListener;
}

export class GeofenceEventBus {
  private entries: readonly ListenerEntry[] = [];

  /** Subscribe to a single kind (`enter` | `exit` | `dwell`). */
  on(kind: GeofenceEventKind, listener: GeofenceEventListener): Unsubscribe {
    return this.add({ kind, listener });
  }

  /** Subscribe to ALL kinds. */
  onAny(listener: GeofenceEventListener): Unsubscribe {
    return this.add({ kind: 'any', listener });
  }

  /** Emit a batch (e.g. the array returned by `engine.detect`). */
  emit(events: readonly GeofenceEvent[]): void {
    if (events.length === 0) return;
    // Snapshot entries so re-entrant `on` / `off` during dispatch
    // can't disturb the loop.
    const snapshot = this.entries;
    for (const event of events) {
      for (const entry of snapshot) {
        if (entry.kind === 'any' || entry.kind === event.kind) {
          try {
            entry.listener(event);
          } catch (err) {
            // A faulty listener must not break the loop.
            // DEFERRED: this package has no injected logger port, so we
            // emit a safe, PII-free message via `console.error`. When a
            // `LoggerPort` is added to the package, swap this call to
            // `logger.warn`. The raw `err` is intentionally discarded —
            // it could contain tenant-bound geofence labels.
            logger.error('[geofence] listener threw; continuing dispatch');
            void err;
          }
        }
      }
    }
  }

  /** Remove every listener. Useful for React `useEffect` cleanup tests. */
  clear(): void {
    this.entries = [];
  }

  private add(entry: ListenerEntry): Unsubscribe {
    this.entries = [...this.entries, entry];
    return () => {
      this.entries = this.entries.filter((e) => e !== entry);
    };
  }
}
