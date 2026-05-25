/**
 * Breach notification service — record + compute required notifications
 * + draft letters.
 *
 * Pure functions:
 *   - `recordBreach(input)` validates and freezes a breach event.
 *   - `requiredNotifications(event)` returns a `NotificationPlan`
 *     entry per affected jurisdiction with computed deadlines.
 *   - `generateBreachLetters(event, recipients)` produces a draft
 *     letter per recipient from a per-jurisdiction template.
 *
 * Severity escalation:
 *   - `informational` / `low`: no statutory notification (operator
 *     records but does not notify).
 *   - `medium`+: regulator notified per jurisdiction SLA; subjects
 *     notified if jurisdiction threshold matches.
 *   - `high` / `critical`: subjects ALWAYS notified regardless of
 *     jurisdiction threshold.
 */

import { BREACH_SLAS } from './sla-table.js';
import type {
  BreachEvent,
  BreachSeverity,
  Jurisdiction,
  NotificationPlan,
  NotificationPlanEntry,
} from '../types.js';

let breachCounter = 0;

function defaultBreachId(): string {
  breachCounter += 1;
  return `breach_${Date.now().toString(36)}_${breachCounter.toString(36)}`;
}

export interface RecordBreachInput {
  readonly severity: BreachSeverity;
  readonly scope: string;
  readonly detectedAt: Date | string;
  readonly affectedJurisdictions: ReadonlyArray<Jurisdiction>;
  readonly affectedTenantIds: ReadonlyArray<string>;
  readonly piiInScope: ReadonlyArray<string>;
  readonly subjectsAffectedCount: number;
  readonly id?: string;
}

export function recordBreach(input: RecordBreachInput): BreachEvent {
  const detectedAt =
    typeof input.detectedAt === 'string'
      ? input.detectedAt
      : input.detectedAt.toISOString();
  if (!input.affectedJurisdictions || input.affectedJurisdictions.length === 0) {
    throw new Error('recordBreach: affectedJurisdictions must be non-empty');
  }
  if (input.subjectsAffectedCount < 0) {
    throw new Error('recordBreach: subjectsAffectedCount cannot be negative');
  }
  return Object.freeze({
    id: input.id ?? defaultBreachId(),
    severity: input.severity,
    scope: input.scope,
    detectedAt,
    affectedJurisdictions: Object.freeze([...input.affectedJurisdictions]),
    affectedTenantIds: Object.freeze([...input.affectedTenantIds]),
    piiInScope: Object.freeze([...input.piiInScope]),
    subjectsAffectedCount: input.subjectsAffectedCount,
  });
}

function isStatutoryNotifiableSeverity(s: BreachSeverity): boolean {
  return s === 'medium' || s === 'high' || s === 'critical';
}

function isSubjectNotificationRequired(
  severity: BreachSeverity,
  threshold: 'always' | 'high_risk_only' | 'never_required',
): boolean {
  if (threshold === 'never_required') return false;
  if (threshold === 'always') return isStatutoryNotifiableSeverity(severity);
  // 'high_risk_only' — only high/critical
  return severity === 'high' || severity === 'critical';
}

function addHours(iso: string, hours: number | null): string | null {
  if (hours === null) return null;
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Compute the required-notification plan for a breach. One entry
 * per affected jurisdiction.
 */
export function requiredNotifications(event: BreachEvent): NotificationPlan {
  const entries: NotificationPlanEntry[] = [];
  for (const jurisdiction of event.affectedJurisdictions) {
    const sla = BREACH_SLAS[jurisdiction] ?? BREACH_SLAS.GLOBAL;
    const notifiable = isStatutoryNotifiableSeverity(event.severity);

    entries.push({
      jurisdiction,
      regulator: notifiable ? sla.regulator : null,
      regulatorDeadline: notifiable
        ? addHours(event.detectedAt, sla.notifyRegulatorWithinHours)
        : null,
      subjectDeadline: notifiable
        ? addHours(event.detectedAt, sla.notifySubjectsWithinHours)
        : null,
      mustNotifySubjects:
        notifiable &&
        isSubjectNotificationRequired(event.severity, sla.subjectNotificationThreshold),
    });
  }
  return Object.freeze({
    breachId: event.id,
    producedAt: new Date().toISOString(),
    entries: Object.freeze(entries),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Letter generation
// ─────────────────────────────────────────────────────────────────────

export interface BreachLetterTemplate {
  readonly jurisdiction: Jurisdiction;
  readonly subject: (event: BreachEvent) => string;
  readonly body: (event: BreachEvent, recipient: BreachLetterRecipient) => string;
}

export type BreachLetterRecipient =
  | { readonly kind: 'regulator'; readonly name: string; readonly contact: string }
  | { readonly kind: 'subject'; readonly subjectId: string; readonly contact: string };

export interface BreachLetter {
  readonly recipient: BreachLetterRecipient;
  readonly jurisdiction: Jurisdiction;
  readonly subject: string;
  readonly body: string;
}

/**
 * Default templates — operators override per-jurisdiction by passing
 * their own template map. The defaults are deliberately formal and
 * generic so they are safe to send unedited if no override exists.
 */
export const DEFAULT_LETTER_TEMPLATES: Readonly<Record<Jurisdiction, BreachLetterTemplate>> = {
  GLOBAL: makeDefaultTemplate('GLOBAL'),
  EU: makeDefaultTemplate('EU'),
  UK: makeDefaultTemplate('UK'),
  'US-CA': makeDefaultTemplate('US-CA'),
  ZA: makeDefaultTemplate('ZA'),
  TZ: makeDefaultTemplate('TZ'),
  KE: makeDefaultTemplate('KE'),
  UG: makeDefaultTemplate('UG'),
  RW: makeDefaultTemplate('RW'),
  NG: makeDefaultTemplate('NG'),
};

function makeDefaultTemplate(jurisdiction: Jurisdiction): BreachLetterTemplate {
  return {
    jurisdiction,
    subject: (event) =>
      `Personal Data Breach Notification — Breach ID ${event.id} (${event.severity})`,
    body: (event, recipient) => {
      const intro =
        recipient.kind === 'regulator'
          ? `Pursuant to the applicable data protection law in ${jurisdiction}, we are notifying you of a personal data breach.`
          : `We are writing to inform you that your personal data may have been affected by a security incident.`;
      const piiList = event.piiInScope.join(', ') || '(none identified)';
      return [
        intro,
        ``,
        `Breach ID: ${event.id}`,
        `Detected at: ${event.detectedAt}`,
        `Severity: ${event.severity}`,
        `Scope: ${event.scope}`,
        `Approximate subjects affected: ${event.subjectsAffectedCount}`,
        `Categories of personal data involved: ${piiList}`,
        ``,
        `Mitigation steps are in progress; we will follow up with further information as our investigation continues.`,
      ].join('\n');
    },
  };
}

export function generateBreachLetters(
  event: BreachEvent,
  recipients: ReadonlyArray<BreachLetterRecipient>,
  templates: Readonly<Record<Jurisdiction, BreachLetterTemplate>> = DEFAULT_LETTER_TEMPLATES,
): ReadonlyArray<BreachLetter> {
  const letters: BreachLetter[] = [];
  for (const jurisdiction of event.affectedJurisdictions) {
    const tpl = templates[jurisdiction] ?? DEFAULT_LETTER_TEMPLATES.GLOBAL;
    for (const recipient of recipients) {
      letters.push({
        recipient,
        jurisdiction,
        subject: tpl.subject(event),
        body: tpl.body(event, recipient),
      });
    }
  }
  return Object.freeze(letters);
}
