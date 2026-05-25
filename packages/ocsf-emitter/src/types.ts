/**
 * OCSF emitter — public types.
 */

import type {
  OCSFActivityId,
  OCSFCategoryUid,
  OCSFClassUid,
  OCSFSeverityId,
  OCSFStatusId,
} from "./ocsf-constants.js";

/** BORJIE-internal audit event — what we ingest. */
export interface InternalAuditEvent {
  readonly kind:
    | "auth.login"
    | "auth.logout"
    | "tool.execute"
    | "policy.decision"
    | "routing.decision"
    | "finding.security";
  readonly sessionId: string;
  readonly userId?: string;
  readonly userRole?: string;
  readonly tenantId?: string;
  readonly success: boolean;
  readonly message?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly tsMs?: number;
}

/** Actor as it appears on the wire. */
export interface OCSFActor {
  readonly session_id: string;
  readonly user_id?: string;
  readonly user_role?: string;
}

/** Policy decision context. */
export interface OCSFPolicy {
  readonly name: string;
  readonly version: string;
  readonly decision: "allow" | "deny" | "escalate";
  readonly rule_matched?: string;
}

/** Privacy + classification. */
export interface OCSFPrivacy {
  readonly data_classification:
    | "public"
    | "internal"
    | "confidential"
    | "restricted";
  readonly pii_stripped: boolean;
  readonly inference_endpoint?: string;
  readonly routing_reason?: string;
}

/** BORJIE extensions on the OCSF envelope. */
export interface BossnyumbaExtensions {
  readonly tool_name?: string;
  readonly tool_category?: string;
  readonly tenant_id?: string;
  readonly portal_id?:
    | "owner"
    | "tenant"
    | "estate-manager"
    | "customer"
    | "platform-admin";
  readonly cost_usd?: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  readonly schema_version?: string;
}

/** Full OCSF envelope BORJIE emits. */
export interface OCSFSecurityEvent {
  readonly id: string;
  readonly schema_version: string;
  readonly class_uid: OCSFClassUid;
  readonly category_uid: OCSFCategoryUid;
  readonly severity_id: OCSFSeverityId;
  readonly time: string;
  readonly timezone_offset: string;
  readonly actor: OCSFActor;
  readonly activity_id: OCSFActivityId;
  readonly activity_name: string;
  readonly status_id: OCSFStatusId;
  readonly status_detail?: string;
  readonly message?: string;
  readonly policy?: OCSFPolicy;
  readonly privacy?: OCSFPrivacy;
  readonly borjie: BossnyumbaExtensions;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Pluggable sink — production wires syslog / HTTP / file / Sentinel. */
export interface OCSFSink {
  emit(event: OCSFSecurityEvent): Promise<void>;
}
