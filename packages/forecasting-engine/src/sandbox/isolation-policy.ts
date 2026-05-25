/**
 * IsolationPolicy — guards on what a sandbox is allowed to do.
 *
 * A sandbox MUST NOT cause real-world side effects (no SMS, no
 * webhooks, no payment APIs). This module ships the constants the
 * sandbox runtime checks before executing any external-effect call.
 */

export const FORBIDDEN_HOSTS: ReadonlyArray<string> = [
  'api.stripe.com',
  'api.mpesa.safaricom.co.ke',
  'sandbox.safaricom.co.ke',
  'gateway.africastalking.com',
  'kra.go.ke',
  'graph.facebook.com',
  'api.twilio.com',
  'api.sendgrid.com',
];

export const FORBIDDEN_DB_TABLES: ReadonlyArray<string> = [
  'sovereign_action_ledger',
  'audit_log',
  'webhook_deliveries',
  'outbound_messages',
];

export interface IsolationCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export function checkHost(host: string): IsolationCheckResult {
  if (FORBIDDEN_HOSTS.some((h) => host.includes(h))) {
    return {
      allowed: false,
      reason: `Sandbox forbidden host: ${host}`,
    };
  }
  return { allowed: true };
}

export function checkTableWrite(tableName: string): IsolationCheckResult {
  if (FORBIDDEN_DB_TABLES.includes(tableName)) {
    return {
      allowed: false,
      reason: `Sandbox forbidden write to table: ${tableName}`,
    };
  }
  return { allowed: true };
}
