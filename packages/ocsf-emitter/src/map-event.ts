/**
 * BORJIE -> OCSF event mapping.
 *
 * Pure function: takes an InternalAuditEvent and produces a
 * conformant OCSFSecurityEvent. Caller passes the event into
 * `emitEvent` to push to the configured sink.
 */

import { randomUUID } from "node:crypto";
import {
  OCSF_ACTIVITY,
  OCSF_CATEGORY,
  OCSF_CLASS,
  OCSF_SEVERITY,
  OCSF_STATUS,
  OCSF_VERSION,
} from "./ocsf-constants.js";
import { deepStripPii } from "./redaction.js";
import type {
  BossnyumbaExtensions,
  InternalAuditEvent,
  OCSFActor,
  OCSFSecurityEvent,
} from "./types.js";

function tzOffset(date: Date): string {
  const offset = date.getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

function classForKind(kind: InternalAuditEvent["kind"]): {
  readonly category_uid: 1 | 2 | 3 | 4 | 5 | 6;
  readonly class_uid: 2001 | 3002 | 3005 | 6001 | 6002 | 6003;
  readonly activity_id: 1 | 2 | 3 | 4 | 5 | 99;
  readonly activity_name: string;
} {
  switch (kind) {
    case "auth.login":
      return {
        category_uid: OCSF_CATEGORY.IDENTITY_ACCESS,
        class_uid: OCSF_CLASS.AUTHENTICATION,
        activity_id: OCSF_ACTIVITY.EXECUTE,
        activity_name: "auth:login",
      };
    case "auth.logout":
      return {
        category_uid: OCSF_CATEGORY.IDENTITY_ACCESS,
        class_uid: OCSF_CLASS.AUTHENTICATION,
        activity_id: OCSF_ACTIVITY.EXECUTE,
        activity_name: "auth:logout",
      };
    case "tool.execute":
      return {
        category_uid: OCSF_CATEGORY.APPLICATION_ACTIVITY,
        class_uid: OCSF_CLASS.API_ACTIVITY,
        activity_id: OCSF_ACTIVITY.EXECUTE,
        activity_name: "tool:execute",
      };
    case "policy.decision":
      return {
        category_uid: OCSF_CATEGORY.IDENTITY_ACCESS,
        class_uid: OCSF_CLASS.AUTHORIZE,
        activity_id: OCSF_ACTIVITY.EXECUTE,
        activity_name: "policy:decision",
      };
    case "routing.decision":
      return {
        category_uid: OCSF_CATEGORY.APPLICATION_ACTIVITY,
        class_uid: OCSF_CLASS.API_ACTIVITY,
        activity_id: OCSF_ACTIVITY.EXECUTE,
        activity_name: "routing:provider",
      };
    case "finding.security":
      return {
        category_uid: OCSF_CATEGORY.FINDINGS,
        class_uid: OCSF_CLASS.SECURITY_FINDING,
        activity_id: OCSF_ACTIVITY.OTHER,
        activity_name: "finding:security",
      };
  }
}

function severityForEvent(event: InternalAuditEvent): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (event.kind === "finding.security") return OCSF_SEVERITY.HIGH;
  if (event.kind === "policy.decision") {
    if (event.detail?.decision === "deny") return OCSF_SEVERITY.HIGH;
    if (event.detail?.decision === "escalate") return OCSF_SEVERITY.MEDIUM;
    return OCSF_SEVERITY.INFORMATIONAL;
  }
  return event.success ? OCSF_SEVERITY.INFORMATIONAL : OCSF_SEVERITY.MEDIUM;
}

export interface MapOptions {
  /** Override the random id generator (tests). */
  readonly idFactory?: () => string;
  /** Override the wall-clock (tests). */
  readonly nowMs?: () => number;
  /** Strip PII from the message + metadata before emitting. Default true. */
  readonly stripPii?: boolean;
}

/**
 * Pure mapping — produces an OCSFSecurityEvent ready for any sink.
 */
export function mapInternalEventToOcsf(
  event: InternalAuditEvent,
  options: MapOptions = {},
): OCSFSecurityEvent {
  const id = (options.idFactory ?? randomUUID)();
  const ts = options.nowMs ? options.nowMs() : event.tsMs ?? Date.now();
  const date = new Date(ts);
  const time = date.toISOString();
  const timezone_offset = tzOffset(date);
  const mapping = classForKind(event.kind);
  const status_id = event.success ? OCSF_STATUS.SUCCESS : OCSF_STATUS.FAILURE;

  const actor: OCSFActor = {
    session_id: event.sessionId,
    ...(event.userId !== undefined ? { user_id: event.userId } : {}),
    ...(event.userRole !== undefined ? { user_role: event.userRole } : {}),
  };

  const shouldStrip = options.stripPii ?? true;
  let message = event.message;
  let metadata: Record<string, unknown> | undefined;
  if (event.detail) {
    const stripped = shouldStrip ? deepStripPii(event.detail) : { value: event.detail, piiFound: false };
    metadata = stripped.value as Record<string, unknown>;
  }
  if (shouldStrip && message) {
    const { stripped } = deepStripPii(message) as {
      stripped?: string;
      value: string;
    };
    message = stripped ?? (deepStripPii(message).value as string);
  }

  const borjie: BossnyumbaExtensions = {
    schema_version: OCSF_VERSION,
    ...(event.tenantId !== undefined ? { tenant_id: event.tenantId } : {}),
  };

  const envelope: OCSFSecurityEvent = {
    id,
    schema_version: OCSF_VERSION,
    class_uid: mapping.class_uid,
    category_uid: mapping.category_uid,
    severity_id: severityForEvent(event),
    time,
    timezone_offset,
    actor,
    activity_id: mapping.activity_id,
    activity_name: mapping.activity_name,
    status_id,
    ...(message !== undefined ? { message } : {}),
    borjie,
    ...(metadata !== undefined ? { metadata } : {}),
  };
  return envelope;
}
