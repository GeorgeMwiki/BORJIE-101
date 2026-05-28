/**
 * Google Address Validation API client.
 *
 * Docs: https://developers.google.com/maps/documentation/address-validation
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §1.4.
 *
 * Endpoint:
 *   POST https://addressvalidation.googleapis.com/v1:validateAddress?key=...
 */

import type {
  AddressValidationGranularity,
  AddressValidationResult,
  ClientCallOptions,
  GeoResult,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress';

interface UpstreamAddressComponent {
  readonly componentName?: { readonly text?: string };
  readonly componentType?: string;
  readonly confirmationLevel?: string;
  readonly inferred?: boolean;
}
interface UpstreamAddress {
  readonly formattedAddress?: string;
  readonly addressComponents?: readonly UpstreamAddressComponent[];
}
interface UpstreamGeocode {
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
  readonly placeId?: string;
}
interface UpstreamVerdict {
  readonly validationGranularity?: string;
  readonly hasInferredComponents?: boolean;
  readonly hasUnconfirmedComponents?: boolean;
}
interface UpstreamResult {
  readonly result?: {
    readonly verdict?: UpstreamVerdict;
    readonly address?: UpstreamAddress;
    readonly geocode?: UpstreamGeocode;
  };
}

const GRANULARITY_SET = new Set<AddressValidationGranularity>([
  'GRANULARITY_UNSPECIFIED',
  'SUB_PREMISE',
  'PREMISE',
  'PREMISE_PROXIMITY',
  'BLOCK',
  'ROUTE',
  'OTHER',
]);

function normalize(raw: UpstreamResult): AddressValidationResult {
  const r = raw.result ?? {};
  const granularityRaw = r.verdict?.validationGranularity ?? 'GRANULARITY_UNSPECIFIED';
  const granularity = GRANULARITY_SET.has(granularityRaw as AddressValidationGranularity)
    ? (granularityRaw as AddressValidationGranularity)
    : 'GRANULARITY_UNSPECIFIED';
  const out: { -readonly [K in keyof AddressValidationResult]: AddressValidationResult[K] } = {
    formattedAddress: r.address?.formattedAddress ?? '',
    validationGranularity: granularity,
    hasInferredComponents: r.verdict?.hasInferredComponents ?? false,
    hasUnconfirmedComponents: r.verdict?.hasUnconfirmedComponents ?? false,
  };
  if (
    r.geocode?.location?.latitude !== undefined &&
    r.geocode.location.longitude !== undefined
  ) {
    out.geocode = {
      lat: r.geocode.location.latitude,
      lng: r.geocode.location.longitude,
    };
  }
  if (r.geocode?.placeId !== undefined) {
    out.placeId = r.geocode.placeId;
  }
  return out;
}

export interface AddressValidationInput {
  /** Lines like ["1600 Amphitheatre Pkwy", "Mountain View, CA 94043"]. */
  readonly addressLines: readonly string[];
  readonly regionCode?: string;
  readonly languageCode?: string;
  /** Pass true on a re-validation of a previously-corrected address. */
  readonly enableUspsCass?: boolean;
}

export async function validateAddress(
  input: AddressValidationInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<AddressValidationResult>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const body: Record<string, unknown> = {
    address: {
      addressLines: input.addressLines,
      ...(input.regionCode ? { regionCode: input.regionCode } : {}),
      ...(input.languageCode ? { languageCode: input.languageCode } : {}),
    },
    ...(input.enableUspsCass ? { enableUspsCass: true } : {}),
  };

  const result = await fetchJson<UpstreamResult>({
    url: withKey(BASE_URL, key),
    method: 'POST',
    body,
    options,
  });
  if (!result.ok) return asError(result);
  return { ok: true, data: normalize(result.data) };
}
