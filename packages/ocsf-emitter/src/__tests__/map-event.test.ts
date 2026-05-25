import { describe, expect, it } from "vitest";
import { mapInternalEventToOcsf } from "../map-event.js";
import {
  OCSF_ACTIVITY,
  OCSF_CATEGORY,
  OCSF_CLASS,
  OCSF_SEVERITY,
  OCSF_STATUS,
  OCSF_VERSION,
} from "../ocsf-constants.js";
import type { InternalAuditEvent } from "../types.js";

const opts = {
  idFactory: () => "fixed-uuid",
  nowMs: () => Date.UTC(2026, 4, 1, 12, 0, 0),
};

describe("mapInternalEventToOcsf — class + category routing", () => {
  it("auth.login -> AUTHENTICATION + IDENTITY_ACCESS", () => {
    const e: InternalAuditEvent = {
      kind: "auth.login",
      sessionId: "s1",
      success: true,
    };
    const o = mapInternalEventToOcsf(e, opts);
    expect(o.class_uid).toBe(OCSF_CLASS.AUTHENTICATION);
    expect(o.category_uid).toBe(OCSF_CATEGORY.IDENTITY_ACCESS);
    expect(o.activity_name).toBe("auth:login");
  });

  it("tool.execute -> API_ACTIVITY + APPLICATION_ACTIVITY", () => {
    const o = mapInternalEventToOcsf(
      { kind: "tool.execute", sessionId: "s", success: true },
      opts,
    );
    expect(o.class_uid).toBe(OCSF_CLASS.API_ACTIVITY);
    expect(o.category_uid).toBe(OCSF_CATEGORY.APPLICATION_ACTIVITY);
  });

  it("policy.decision -> AUTHORIZE", () => {
    const o = mapInternalEventToOcsf(
      { kind: "policy.decision", sessionId: "s", success: true },
      opts,
    );
    expect(o.class_uid).toBe(OCSF_CLASS.AUTHORIZE);
  });

  it("routing.decision -> API_ACTIVITY", () => {
    const o = mapInternalEventToOcsf(
      { kind: "routing.decision", sessionId: "s", success: true },
      opts,
    );
    expect(o.class_uid).toBe(OCSF_CLASS.API_ACTIVITY);
  });

  it("finding.security -> SECURITY_FINDING", () => {
    const o = mapInternalEventToOcsf(
      { kind: "finding.security", sessionId: "s", success: false },
      opts,
    );
    expect(o.class_uid).toBe(OCSF_CLASS.SECURITY_FINDING);
    expect(o.severity_id).toBe(OCSF_SEVERITY.HIGH);
  });
});

describe("mapInternalEventToOcsf — severity rules", () => {
  it("policy deny -> HIGH", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "policy.decision",
        sessionId: "s",
        success: false,
        detail: { decision: "deny" },
      },
      opts,
    );
    expect(o.severity_id).toBe(OCSF_SEVERITY.HIGH);
  });

  it("policy escalate -> MEDIUM", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "policy.decision",
        sessionId: "s",
        success: false,
        detail: { decision: "escalate" },
      },
      opts,
    );
    expect(o.severity_id).toBe(OCSF_SEVERITY.MEDIUM);
  });

  it("tool execute success -> INFORMATIONAL", () => {
    const o = mapInternalEventToOcsf(
      { kind: "tool.execute", sessionId: "s", success: true },
      opts,
    );
    expect(o.severity_id).toBe(OCSF_SEVERITY.INFORMATIONAL);
  });

  it("tool execute failure -> MEDIUM", () => {
    const o = mapInternalEventToOcsf(
      { kind: "tool.execute", sessionId: "s", success: false },
      opts,
    );
    expect(o.severity_id).toBe(OCSF_SEVERITY.MEDIUM);
  });
});

describe("mapInternalEventToOcsf — status + actor", () => {
  it("success -> SUCCESS status_id", () => {
    const o = mapInternalEventToOcsf(
      { kind: "auth.login", sessionId: "s", success: true },
      opts,
    );
    expect(o.status_id).toBe(OCSF_STATUS.SUCCESS);
  });

  it("failure -> FAILURE status_id", () => {
    const o = mapInternalEventToOcsf(
      { kind: "auth.login", sessionId: "s", success: false },
      opts,
    );
    expect(o.status_id).toBe(OCSF_STATUS.FAILURE);
  });

  it("populates actor session, user, role", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "auth.login",
        sessionId: "s1",
        userId: "u1",
        userRole: "OWNER",
        success: true,
      },
      opts,
    );
    expect(o.actor).toEqual({
      session_id: "s1",
      user_id: "u1",
      user_role: "OWNER",
    });
  });
});

describe("mapInternalEventToOcsf — envelope shape", () => {
  it("stamps schema_version OCSF 1.5.0", () => {
    const o = mapInternalEventToOcsf(
      { kind: "auth.login", sessionId: "s", success: true },
      opts,
    );
    expect(o.schema_version).toBe(OCSF_VERSION);
    expect(o.borjie.schema_version).toBe(OCSF_VERSION);
  });

  it("produces an ISO timestamp + timezone offset", () => {
    const o = mapInternalEventToOcsf(
      { kind: "auth.login", sessionId: "s", success: true },
      opts,
    );
    expect(o.time).toMatch(/^2026-/);
    expect(o.timezone_offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it("activity_id is OTHER for finding.security", () => {
    const o = mapInternalEventToOcsf(
      { kind: "finding.security", sessionId: "s", success: false },
      opts,
    );
    expect(o.activity_id).toBe(OCSF_ACTIVITY.OTHER);
  });

  it("propagates tenant id into borjie extension", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "tool.execute",
        sessionId: "s",
        success: true,
        tenantId: "tenant-xyz",
      },
      opts,
    );
    expect(o.borjie.tenant_id).toBe("tenant-xyz");
  });
});

describe("mapInternalEventToOcsf — redaction", () => {
  it("strips PII from detail by default", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "tool.execute",
        sessionId: "s",
        success: true,
        detail: { contact: "user@example.com" },
      },
      opts,
    );
    expect((o.metadata as { contact: string })?.contact).toBe("[REDACTED]");
  });

  it("skips PII strip when option is false", () => {
    const o = mapInternalEventToOcsf(
      {
        kind: "tool.execute",
        sessionId: "s",
        success: true,
        detail: { contact: "user@example.com" },
      },
      { ...opts, stripPii: false },
    );
    expect((o.metadata as { contact: string })?.contact).toBe(
      "user@example.com",
    );
  });
});
