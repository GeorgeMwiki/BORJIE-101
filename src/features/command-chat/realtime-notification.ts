/**
 * Map a brain realtime-feed event to a CommandChatRealtimeNotification.
 *
 * Pure function — no I/O. Used by the stream route to convert events
 * coming from `subscribeBrainFeed` into the SSE protocol shape the
 * chat client expects.
 */

import type { BrainFeedEventUnion } from "@/core/brain/realtime-feeds";
import type { CommandChatRealtimeNotificationEvent } from "./protocol";

export function brainFeedEventToNotification(
  event: BrainFeedEventUnion,
): CommandChatRealtimeNotificationEvent {
  switch (event.kind) {
    case "approval-granted":
      return {
        kind: "approval-granted",
        severity: "success",
        summary: `Approval ${event.approvalId} granted for ${event.action}`,
        subjectId: event.approvalId,
        ts: event.ts,
      };
    case "approval-denied":
      return {
        kind: "approval-denied",
        severity: "warn",
        summary: `Approval ${event.approvalId} denied for ${event.action}: ${event.reason}`,
        subjectId: event.approvalId,
        ts: event.ts,
      };
    case "officer-alert": {
      // Map level (info/warn/crit) → severity. info / warn are
      // pass-through; crit elevates to crit.
      const severity: CommandChatRealtimeNotificationEvent["severity"] =
        event.level === "crit"
          ? "crit"
          : event.level === "warn"
            ? "warn"
            : "info";
      return {
        kind: "officer-alert",
        severity,
        summary: event.message,
        subjectId: event.applicationId,
        ts: event.ts,
      };
    }
    case "intelligence":
      return {
        kind: "intelligence",
        severity: "info",
        summary: `Intelligence event: ${event.eventType}`,
        subjectId: event.applicationId,
        ts: event.ts,
      };
    case "cron-tick":
      return {
        kind: "cron-tick",
        severity: event.outcome === "failed" ? "crit" : "info",
        summary:
          event.outcome === "failed"
            ? `Cron ${event.name} failed${event.errorMessage ? `: ${event.errorMessage}` : ""}`
            : `Cron ${event.name} completed in ${event.durationMs}ms`,
        ts: event.ts,
      };
  }
}
