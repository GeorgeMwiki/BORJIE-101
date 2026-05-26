/**
 * public-api test — sanity-check the package barrel.
 *
 * The session-mirror package is consumed by both the Next.js owner
 * apps (browser side) AND by the api-gateway (server-side snapshot
 * reader). The barrel SHOULD expose the right surface to each, with
 * no accidental cross-dependency that would force a heavy import
 * (jsdom, fetch polyfill) on the wrong side.
 *
 * This test is the contract — if it fails, the barrel was tampered
 * with in a breaking way.
 */

import { describe, expect, it } from 'vitest';
import * as api from '../index.js';

describe('@borjie/session-mirror public surface', () => {
  it('exposes the Tier II + Tier III factories', () => {
    expect(typeof api.createFieldStateMirror).toBe('function');
    expect(typeof api.readUiStateGraph).toBe('function');
    expect(typeof api.emptyGraph).toBe('function');
  });

  it('exposes the capture client builder + buildBatch helper', () => {
    expect(typeof api.createCaptureClient).toBe('function');
    expect(typeof api.buildBatch).toBe('function');
  });

  it('exposes the BatchFlusher class', () => {
    expect(typeof api.BatchFlusher).toBe('function');
    // Constructor sanity.
    const instance = new api.BatchFlusher({
      onFlush: () => undefined,
    });
    expect(typeof instance.enqueue).toBe('function');
    expect(typeof instance.flushNow).toBe('function');
    expect(typeof instance.stop).toBe('function');
    instance.stop();
  });

  it('exposes the redactor + classifier', () => {
    expect(typeof api.classify).toBe('function');
    expect(typeof api.redact).toBe('function');
  });

  it('exposes the UI-state digest helper', () => {
    expect(typeof api.digestOf).toBe('function');
  });

  it('exposes the React hooks (referentially identifiable as functions)', () => {
    expect(typeof api.useFieldCapture).toBe('function');
    expect(typeof api.useUiStateBeacon).toBe('function');
    expect(typeof api.useSessionScope).toBe('function');
    expect(typeof api.useCaptureEmit).toBe('function');
    expect(typeof api.SessionMirrorProvider).toBe('function');
  });
});
