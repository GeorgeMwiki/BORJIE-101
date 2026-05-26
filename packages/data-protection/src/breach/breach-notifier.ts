/**
 * breach-notifier — N-hour authority + subject notification.
 *
 * The notifier is jurisdiction-agnostic. The supervisory authority's
 * notification window is sourced from `ComplianceFrameworkPort.
 * breachAuthorityNotificationHours` (typically 72 h under most modern
 * data-protection regimes; some jurisdictions impose 24 h or 48 h).
 *
 * The notifier is a pure state machine: it accepts the breach event +
 * the framework port + the current time, and returns whether the
 * notification deadlines have been respected.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  DataProtectionInvariantError,
  type BreachSeverity,
  type Classification,
  type ComplianceFrameworkPort,
} from '../types.js';

export interface BreachEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly detectedAt: Date;
  readonly severity: BreachSeverity;
  readonly affectedClasses: ReadonlyArray<Classification>;
  readonly affectedCountEstimate: number;
  readonly notifiedAuthorityAt: Date | null;
  readonly notifiedSubjectsAt: Date | null;
  readonly resolution: string | null;
  readonly prevHash: string;
  readonly auditHash: string;
}

function hashEvent(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly detectedAt: Date;
  readonly severity: BreachSeverity;
  readonly affectedClasses: ReadonlyArray<Classification>;
  readonly affectedCountEstimate: number;
  readonly notifiedAuthorityAt: Date | null;
  readonly notifiedSubjectsAt: Date | null;
  readonly resolution: string | null;
  readonly prevHash: string;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [
          input.id,
          input.tenantId,
          input.detectedAt.toISOString(),
          input.severity,
          [...input.affectedClasses].sort().join(','),
          String(input.affectedCountEstimate),
          input.notifiedAuthorityAt
            ? input.notifiedAuthorityAt.toISOString()
            : '',
          input.notifiedSubjectsAt
            ? input.notifiedSubjectsAt.toISOString()
            : '',
          input.resolution ?? '',
          input.prevHash,
        ].join('|'),
      ),
    ),
  );
}

export function createBreachEvent(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly detectedAt: Date;
  readonly severity: BreachSeverity;
  readonly affectedClasses: ReadonlyArray<Classification>;
  readonly affectedCountEstimate: number;
  readonly prevHash?: string;
}): BreachEvent {
  const prevHash = input.prevHash ?? '';
  const auditHash = hashEvent({
    id: input.id,
    tenantId: input.tenantId,
    detectedAt: input.detectedAt,
    severity: input.severity,
    affectedClasses: input.affectedClasses,
    affectedCountEstimate: input.affectedCountEstimate,
    notifiedAuthorityAt: null,
    notifiedSubjectsAt: null,
    resolution: null,
    prevHash,
  });
  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    detectedAt: input.detectedAt,
    severity: input.severity,
    affectedClasses: Object.freeze([...input.affectedClasses]),
    affectedCountEstimate: input.affectedCountEstimate,
    notifiedAuthorityAt: null,
    notifiedSubjectsAt: null,
    resolution: null,
    prevHash,
    auditHash,
  });
}

export function notifyAuthority(input: {
  readonly event: BreachEvent;
  readonly at: Date;
}): BreachEvent {
  if (input.event.notifiedAuthorityAt !== null) {
    throw new DataProtectionInvariantError(
      'breach.authority_already_notified',
      'Authority already notified for this event.',
    );
  }
  const prevHash = input.event.auditHash;
  const auditHash = hashEvent({
    id: input.event.id,
    tenantId: input.event.tenantId,
    detectedAt: input.event.detectedAt,
    severity: input.event.severity,
    affectedClasses: input.event.affectedClasses,
    affectedCountEstimate: input.event.affectedCountEstimate,
    notifiedAuthorityAt: input.at,
    notifiedSubjectsAt: input.event.notifiedSubjectsAt,
    resolution: input.event.resolution,
    prevHash,
  });
  return Object.freeze({
    ...input.event,
    notifiedAuthorityAt: input.at,
    prevHash,
    auditHash,
  });
}

export function notifySubjects(input: {
  readonly event: BreachEvent;
  readonly at: Date;
}): BreachEvent {
  const prevHash = input.event.auditHash;
  const auditHash = hashEvent({
    id: input.event.id,
    tenantId: input.event.tenantId,
    detectedAt: input.event.detectedAt,
    severity: input.event.severity,
    affectedClasses: input.event.affectedClasses,
    affectedCountEstimate: input.event.affectedCountEstimate,
    notifiedAuthorityAt: input.event.notifiedAuthorityAt,
    notifiedSubjectsAt: input.at,
    resolution: input.event.resolution,
    prevHash,
  });
  return Object.freeze({
    ...input.event,
    notifiedSubjectsAt: input.at,
    prevHash,
    auditHash,
  });
}

export interface DeadlineCheck {
  readonly authorityOnTime: boolean;
  readonly subjectsOnTime: boolean;
  readonly authorityHoursRemaining: number;
  readonly subjectHoursRemaining: number;
}

/**
 * Evaluate the authority + subject deadlines against the framework's
 * notification windows.
 *
 * `authorityOnTime` is FALSE iff:
 *   - `notifiedAuthorityAt` is set but is AFTER `detectedAt + framework
 *     .breachAuthorityNotificationHours`; OR
 *   - `notifiedAuthorityAt` is null AND `now > detectedAt + window`.
 */
export function evaluateDeadlines(input: {
  readonly event: BreachEvent;
  readonly framework: ComplianceFrameworkPort;
  readonly now: Date;
  /** When true, subjects MUST be notified (high-risk per spec §6.4). */
  readonly subjectsRequired: boolean;
}): DeadlineCheck {
  const { event, framework, now, subjectsRequired } = input;
  const HOUR_MS = 60 * 60 * 1000;
  const authorityDeadline = new Date(
    event.detectedAt.getTime() +
      framework.breachAuthorityNotificationHours * HOUR_MS,
  );
  const subjectDeadline = new Date(
    event.detectedAt.getTime() +
      framework.breachSubjectNotificationHours * HOUR_MS,
  );

  const authorityOnTime = event.notifiedAuthorityAt
    ? event.notifiedAuthorityAt.getTime() <= authorityDeadline.getTime()
    : now.getTime() <= authorityDeadline.getTime();

  const subjectsOnTime = !subjectsRequired
    ? true
    : event.notifiedSubjectsAt
      ? event.notifiedSubjectsAt.getTime() <= subjectDeadline.getTime()
      : now.getTime() <= subjectDeadline.getTime();

  return Object.freeze({
    authorityOnTime,
    subjectsOnTime,
    authorityHoursRemaining:
      (authorityDeadline.getTime() - now.getTime()) / HOUR_MS,
    subjectHoursRemaining:
      (subjectDeadline.getTime() - now.getTime()) / HOUR_MS,
  });
}
