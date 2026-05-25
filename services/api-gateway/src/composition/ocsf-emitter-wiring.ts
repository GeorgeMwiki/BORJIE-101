/**
 * PO-port wave-5 wiring #3 — OCSF emitter composition helper.
 *
 * Builds the OCSF audit sink + a thin `.emit()` wrapper exposed via
 * `ServiceRegistry.ocsf`. Pluggable backends:
 *
 *   - `OCSF_LOG_PATH` (env)   → append-only JSON-lines file sink
 *   - default                 → in-memory sink (dev / staging)
 *
 * The wrapper is fire-and-forget: sink errors are swallowed inside
 * `emitOcsfEvent` so a transient SIEM outage cannot break a response
 * path. Returns the boolean `emitted` flag from the emit pipeline so
 * callers may surface a debug counter.
 *
 * Production SIEM forwarders (syslog, HTTP push to Sentinel / Splunk)
 * land as follow-up sink adapters wired through the same helper.
 */

import { appendFile } from 'node:fs/promises';
import {
  createInMemorySink as createInMemoryOcsfSink,
  createLineSink as createOcsfLineSink,
  emitEvent as emitOcsfEvent,
  type InternalAuditEvent as OcsfInternalAuditEvent,
  type LineWriter,
  type OCSFSink,
} from '@borjie/ocsf-emitter';

export interface OcsfBundle {
  readonly sink: OCSFSink;
  readonly emit: (
    event: OcsfInternalAuditEvent,
  ) => Promise<{ readonly emitted: boolean }>;
}

/**
 * Build an OCSF sink backed by an append-only file at `path`. Uses
 * async `appendFile` so the request event loop never stalls on disk
 * latency — critical for high-traffic webhook endpoints
 * (`/africastalking`, `/twilio`, `/meta`, `/inngest`) that all hit
 * `ocsf.emit` on the request thread. Rotate via logrotate or the
 * SIEM-side collector.
 */
function createFileLineWriter(path: string): LineWriter {
  return {
    async write(line: string): Promise<void> {
      try {
        await appendFile(path, line, { encoding: 'utf8' });
      } catch {
        // Fire-and-forget — never propagate file errors.
      }
    },
  };
}

/**
 * Compose the OCSF audit bundle. Reads `OCSF_LOG_PATH` to choose the
 * sink backend; falls back to the in-memory sink (handy for dev +
 * unit tests).
 */
export function createOcsfBundle(): OcsfBundle {
  const path = process.env.OCSF_LOG_PATH?.trim();
  const sink: OCSFSink = path
    ? createOcsfLineSink(createFileLineWriter(path))
    : createInMemoryOcsfSink();

  return {
    sink,
    async emit(event: OcsfInternalAuditEvent) {
      try {
        const result = await emitOcsfEvent(sink, event);
        return { emitted: result.emitted };
      } catch {
        // Defensive: emitOcsfEvent already catches sink errors, but
        // any synchronous mapping failure should still degrade
        // silently.
        return { emitted: false };
      }
    },
  };
}
