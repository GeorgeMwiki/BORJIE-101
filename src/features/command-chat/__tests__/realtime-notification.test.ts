/**
 * Tests the brain-feed → command-chat-notification mapper.
 * Pure-function tests; no I/O.
 */

import { describe, it, expect } from "vitest";

import { brainFeedEventToNotification } from "../realtime-notification";
import type { BrainFeedEventUnion } from "@/core/brain/realtime-feeds";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("brainFeedEventToNotification", () => {
  it("maps approval-granted to a `success` severity notification", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "approval-granted",
      tenantId: TENANT,
      ts: 1700000000000,
      approvalId: "appr-42",
      action: "promote_model",
      requesterId: "u-r",
      approverId: "u-a",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.kind).toBe("approval-granted");
    expect(n.severity).toBe("success");
    expect(n.summary).toContain("appr-42");
    expect(n.summary).toContain("promote_model");
    expect(n.subjectId).toBe("appr-42");
    expect(n.ts).toBe(1700000000000);
  });

  it("maps approval-denied to a `warn` severity notification with reason", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "approval-denied",
      tenantId: TENANT,
      ts: 1700000000001,
      approvalId: "appr-43",
      action: "release_funds",
      reason: "missing-evidence",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("warn");
    expect(n.summary).toContain("missing-evidence");
  });

  it("maps crit officer-alert to `crit` severity", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "officer-alert",
      tenantId: TENANT,
      ts: 1700000000002,
      level: "crit",
      message: "Officer queue capacity exhausted",
      applicationId: "app-9",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("crit");
    expect(n.summary).toBe("Officer queue capacity exhausted");
    expect(n.subjectId).toBe("app-9");
  });

  it("maps warn-level officer-alert to `warn` severity", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "officer-alert",
      tenantId: TENANT,
      ts: 1700000000003,
      level: "warn",
      message: "review backlog growing",
      applicationId: "app-10",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("warn");
  });

  it("maps info-level officer-alert to `info` severity", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "officer-alert",
      tenantId: TENANT,
      ts: 1700000000004,
      level: "info",
      message: "new case assigned",
      applicationId: "app-11",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("info");
  });

  it("maps intelligence event to `info` severity", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "intelligence",
      tenantId: TENANT,
      ts: 1700000000005,
      eventType: "DOCUMENT_ANALYZED",
      applicationId: "app-12",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.kind).toBe("intelligence");
    expect(n.severity).toBe("info");
    expect(n.summary).toContain("DOCUMENT_ANALYZED");
  });

  it("maps failed cron-tick to `crit` severity with error message", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "cron-tick",
      tenantId: TENANT,
      ts: 1700000000006,
      name: "heartbeat-tick",
      outcome: "failed",
      durationMs: 5000,
      errorMessage: "supabase: connection timeout",
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("crit");
    expect(n.summary).toContain("heartbeat-tick");
    expect(n.summary).toContain("connection timeout");
  });

  it("maps successful cron-tick to `info` severity with duration", () => {
    const event: BrainFeedEventUnion = Object.freeze({
      kind: "cron-tick",
      tenantId: TENANT,
      ts: 1700000000007,
      name: "rpe-tick",
      outcome: "ok",
      durationMs: 240,
      payload: Object.freeze({}),
    });
    const n = brainFeedEventToNotification(event);
    expect(n.severity).toBe("info");
    expect(n.summary).toContain("rpe-tick");
    expect(n.summary).toContain("240ms");
  });
});
