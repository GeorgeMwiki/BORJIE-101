/**
 * HubSpot normalizer — raw CRM search row → canonical envelope.
 */

import type {
  HubSpotObjectPayload,
  HubSpotObjectType,
} from '../types.js';
import type { SearchResultRow } from '../client/hubspot-client.js';

export interface NormaliseParams {
  readonly objectType: HubSpotObjectType;
  readonly row: SearchResultRow;
}

export function normaliseHubSpotRow(
  params: NormaliseParams,
): HubSpotObjectPayload | null {
  const props = params.row.properties;
  const updatedRaw = props.hs_lastmodifieddate;
  const updatedAt = typeof updatedRaw === 'string' ? updatedRaw : params.row.updatedAt;
  if (typeof updatedAt !== 'string') return null;
  if (typeof params.row.id !== 'string' || params.row.id === '') return null;
  return {
    objectType: params.objectType,
    objectId: params.row.id,
    firstName: stringProp(props, 'firstname'),
    lastName: stringProp(props, 'lastname'),
    company: stringProp(props, 'company') ?? stringProp(props, 'name'),
    emailHashed: stringProp(props, 'email'),
    phoneHashed: stringProp(props, 'phone') ?? stringProp(props, 'mobilephone'),
    dealName: params.objectType === 'deals' ? stringProp(props, 'dealname') : null,
    amount: params.objectType === 'deals' ? numberProp(props, 'amount') : null,
    stage:
      params.objectType === 'deals'
        ? stringProp(props, 'dealstage')
        : params.objectType === 'tickets'
          ? stringProp(props, 'hs_pipeline_stage')
          : null,
    updatedAt,
  };
}

function stringProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const v = props[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function numberProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const v = props[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
