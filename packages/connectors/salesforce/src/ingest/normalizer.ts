/**
 * Salesforce normalizer — raw SOQL record → canonical
 * `SalesforceSObjectPayload`. Pure, deterministic, side-effect-free.
 *
 * The redactor runs BEFORE normalisation so the canonical payload
 * already carries hashed values; the normalizer simply lifts the
 * v1 field subset out of `raw`.
 */

import type {
  SalesforceSObjectPayload,
  SalesforceSObjectType,
} from '../types.js';
import type { SoqlQueryResultRecord } from '../client/salesforce-client.js';

const SOBJECT_TYPES: ReadonlySet<SalesforceSObjectType> = new Set([
  'Account',
  'Opportunity',
  'Contact',
  'Case',
]);

export interface NormaliseParams {
  readonly record: SoqlQueryResultRecord;
}

export function normaliseSalesforceRecord(
  params: NormaliseParams,
): SalesforceSObjectPayload | null {
  const sobjectTypeRaw = params.record.attributes?.type;
  if (typeof sobjectTypeRaw !== 'string' || !SOBJECT_TYPES.has(sobjectTypeRaw as SalesforceSObjectType)) {
    return null;
  }
  const sobjectType = sobjectTypeRaw as SalesforceSObjectType;
  const id = stringField(params.record, 'Id');
  if (id === null) return null;
  const lmd = stringField(params.record, 'LastModifiedDate');
  if (lmd === null) return null;
  return {
    sobjectType,
    sobjectId: id,
    name: stringField(params.record, 'Name'),
    emailHashed: stringField(params.record, 'Email'),
    phoneHashed: stringField(params.record, 'Phone'),
    stage:
      sobjectType === 'Opportunity'
        ? stringField(params.record, 'StageName')
        : sobjectType === 'Case'
          ? stringField(params.record, 'Status')
          : null,
    amount: sobjectType === 'Opportunity' ? numberField(params.record, 'Amount') : null,
    closeDate: sobjectType === 'Opportunity' ? stringField(params.record, 'CloseDate') : null,
    lastModifiedDate: lmd,
  };
}

function stringField(rec: SoqlQueryResultRecord, name: string): string | null {
  const raw = (rec as Record<string, unknown>)[name];
  return typeof raw === 'string' ? raw : null;
}

function numberField(rec: SoqlQueryResultRecord, name: string): number | null {
  const raw = (rec as Record<string, unknown>)[name];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}
