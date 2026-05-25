/**
 * OCSF (Open Cybersecurity Schema Framework) constants — v1.5.
 *
 * https://schema.ocsf.io/1.5.0
 *
 * Subset relevant to BORJIE. Adding a new class is one line
 * change + a mapping case in `map-event.ts`.
 */

/** Category UIDs. */
export const OCSF_CATEGORY = {
  SYSTEM_ACTIVITY: 1,
  FINDINGS: 2,
  IDENTITY_ACCESS: 3,
  NETWORK_ACTIVITY: 4,
  DISCOVERY: 5,
  APPLICATION_ACTIVITY: 6,
} as const;
export type OCSFCategoryUid =
  (typeof OCSF_CATEGORY)[keyof typeof OCSF_CATEGORY];

/** Class UIDs (subset). */
export const OCSF_CLASS = {
  /** 3002 — Authentication. */
  AUTHENTICATION: 3002,
  /** 3005 — Authorization / Access Control. */
  AUTHORIZE: 3005,
  /** 6001 — Web Resources Activity. */
  WEB_RESOURCES: 6001,
  /** 6002 — Application Lifecycle. */
  APP_LIFECYCLE: 6002,
  /** 6003 — API Activity. */
  API_ACTIVITY: 6003,
  /** 2001 — Security Finding. */
  SECURITY_FINDING: 2001,
} as const;
export type OCSFClassUid = (typeof OCSF_CLASS)[keyof typeof OCSF_CLASS];

/** Severity IDs. */
export const OCSF_SEVERITY = {
  UNKNOWN: 0,
  INFORMATIONAL: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
  FATAL: 6,
} as const;
export type OCSFSeverityId =
  (typeof OCSF_SEVERITY)[keyof typeof OCSF_SEVERITY];

/** Activity IDs. */
export const OCSF_ACTIVITY = {
  CREATE: 1,
  READ: 2,
  UPDATE: 3,
  DELETE: 4,
  EXECUTE: 5,
  OTHER: 99,
} as const;
export type OCSFActivityId =
  (typeof OCSF_ACTIVITY)[keyof typeof OCSF_ACTIVITY];

/** Status IDs. */
export const OCSF_STATUS = {
  SUCCESS: 1,
  FAILURE: 2,
} as const;
export type OCSFStatusId = (typeof OCSF_STATUS)[keyof typeof OCSF_STATUS];

/** OCSF schema version this emitter conforms to. */
export const OCSF_VERSION = "1.5.0" as const;
