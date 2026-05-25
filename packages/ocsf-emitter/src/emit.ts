/**
 * Emit — push OCSF events through the pluggable sink.
 *
 * Fire-and-forget contract: never throws; sink errors are returned
 * via a boolean so caller can log without taking a critical path.
 */

import { mapInternalEventToOcsf, type MapOptions } from "./map-event.js";
import type { InternalAuditEvent, OCSFSecurityEvent, OCSFSink } from "./types.js";

export interface EmitResult {
  readonly emitted: boolean;
  readonly event: OCSFSecurityEvent;
}

export async function emitEvent(
  sink: OCSFSink,
  event: InternalAuditEvent,
  options: MapOptions = {},
): Promise<EmitResult> {
  const ocsfEvent = mapInternalEventToOcsf(event, options);
  try {
    await sink.emit(ocsfEvent);
    return { emitted: true, event: ocsfEvent };
  } catch {
    return { emitted: false, event: ocsfEvent };
  }
}

/**
 * In-memory sink — for tests and debug.
 */
export function createInMemorySink(): OCSFSink & {
  events: OCSFSecurityEvent[];
  clear: () => void;
} {
  const events: OCSFSecurityEvent[] = [];
  return {
    events,
    async emit(e) {
      events.push(e);
    },
    clear() {
      events.length = 0;
    },
  };
}

/**
 * JSON-line sink — appends each event as JSON to the writer's chunk
 * stream. Used in production to pipe to syslog / file.
 */
export interface LineWriter {
  write(line: string): Promise<void>;
}

export function createLineSink(writer: LineWriter): OCSFSink {
  return {
    async emit(e) {
      await writer.write(`${JSON.stringify(e)}\n`);
    },
  };
}
