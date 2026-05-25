/**
 * Piece N — marketplace publish + search + inquire.
 *
 * Publishing a listing flips a parcel onto the cross-tenant marketplace
 * via the `public_parcel_listings_v` view (gated on
 * `listing_status='active'` AND `listing_visible_publicly=TRUE`).
 *
 * Search hits the view directly via `port.searchPublicListings`. The
 * adapter MUST NOT short-circuit to the base table — RLS on the base
 * table would only show the caller's own tenant rows, defeating the
 * point of a marketplace.
 *
 * Inquiries are written with `tenant_id` set to the LISTING'S tenant
 * (not the inquirer's). That way the listing owner sees the inquiry
 * via their normal RLS-isolated read path.
 */

import {
  GeoParcelsError,
  MarketplaceInquirySchema,
  MarketplaceListingSchema,
  MarketplaceSearchFiltersSchema,
} from './types.js';
import type {
  MarketplaceInquiry,
  MarketplaceListing,
  MarketplaceSearchFilters,
} from './types.js';
import type { GeoParcelsPort } from './persistence-port.js';
import { appendActivity } from './activity-log.js';

export interface PublishListingArgs {
  id: string;
  tenant_id: string;
  listed_by_user_id: string;
  parcel_id?: string | null;
  land_area_id?: string | null;
  listing_kind: MarketplaceListing['listing_kind'];
  title: string;
  description: string;
  asking_price_minor_units?: number | null;
  currency_code?: string | null;
  listing_visible_publicly?: boolean;
  listing_visible_to_tenant_ids?: string[];
  features_jsonb?: Record<string, unknown>;
  image_urls?: string[];
  contact_method?: MarketplaceListing['contact_method'];
  expires_at?: Date | null;
  /** If true, persist as 'active' immediately. Otherwise 'draft'. */
  publish_immediately?: boolean;
  actor_persona_id?: string | null;
}

export async function publishListing(
  port: GeoParcelsPort,
  args: PublishListingArgs,
): Promise<MarketplaceListing> {
  if (!args.parcel_id && !args.land_area_id) {
    throw new GeoParcelsError(
      'NO_SUBJECT',
      'publishListing requires either parcel_id or land_area_id',
    );
  }
  if (args.asking_price_minor_units != null && !args.currency_code) {
    throw new GeoParcelsError(
      'NO_CURRENCY',
      'asking_price_minor_units provided without currency_code — multi-currency requires explicit code',
    );
  }

  const row: MarketplaceListing = {
    id: args.id,
    tenant_id: args.tenant_id,
    listed_by_user_id: args.listed_by_user_id,
    parcel_id: args.parcel_id ?? null,
    land_area_id: args.land_area_id ?? null,
    listing_kind: args.listing_kind,
    title: args.title,
    description: args.description,
    asking_price_minor_units: args.asking_price_minor_units ?? null,
    currency_code: args.currency_code ?? null,
    listing_status: args.publish_immediately ? 'active' : 'draft',
    listing_visible_publicly: args.listing_visible_publicly ?? true,
    listing_visible_to_tenant_ids: args.listing_visible_to_tenant_ids ?? [],
    features_jsonb: args.features_jsonb ?? {},
    image_urls: args.image_urls ?? [],
    contact_method: args.contact_method ?? 'in_app',
    expires_at: args.expires_at ? args.expires_at.toISOString() : null,
  };

  const result = MarketplaceListingSchema.safeParse(row);
  if (!result.success) {
    throw new GeoParcelsError(
      'INVALID_LISTING',
      `listing failed validation: ${result.error.message}`,
    );
  }

  const persisted = await port.insertListing(row);

  // Log on the underlying parcel (if any).
  if (args.parcel_id) {
    await appendActivity(port, {
      id: `${args.parcel_id}_listed_${args.id}`,
      tenant_id: args.tenant_id,
      parcel_id: args.parcel_id,
      event_kind: 'listed',
      event_payload_jsonb: {
        listing_id: args.id,
        listing_kind: args.listing_kind,
        listing_status: persisted.listing_status,
        asking_price_minor_units: args.asking_price_minor_units ?? null,
        currency_code: args.currency_code ?? null,
      },
      actor_user_id: args.listed_by_user_id,
      actor_persona_id: args.actor_persona_id ?? null,
    });
  }

  return persisted;
}

export interface UpdateListingStatusArgs {
  listing_id: string;
  tenant_id: string;
  next_status: MarketplaceListing['listing_status'];
  actor_user_id: string;
  actor_persona_id?: string | null;
  sold_to_user_id?: string | null;
}

export async function updateListingStatus(
  port: GeoParcelsPort,
  args: UpdateListingStatusArgs,
): Promise<MarketplaceListing> {
  const existing = await port.getListing(args.listing_id, args.tenant_id);
  if (!existing) {
    throw new GeoParcelsError('LISTING_NOT_FOUND', `listing ${args.listing_id} not found`);
  }

  const patch: Partial<MarketplaceListing> = {
    listing_status: args.next_status,
  };

  if (args.next_status === 'sold') {
    patch.sold_at = new Date().toISOString();
    if (args.sold_to_user_id) {
      patch.sold_to_user_id = args.sold_to_user_id;
    }
  }

  const updated = await port.updateListing(args.listing_id, args.tenant_id, patch);

  // Log on underlying parcel.
  if (existing.parcel_id) {
    const eventKind =
      args.next_status === 'sold'
        ? 'sold'
        : args.next_status === 'active'
          ? 'listed'
          : 'status_changed';

    await appendActivity(port, {
      id: `${existing.parcel_id}_listing_${args.next_status}_${Date.now()}`,
      tenant_id: args.tenant_id,
      parcel_id: existing.parcel_id,
      event_kind: eventKind,
      event_payload_jsonb: {
        listing_id: args.listing_id,
        prev_status: existing.listing_status,
        next_status: args.next_status,
        sold_to_user_id: args.sold_to_user_id ?? null,
      },
      actor_user_id: args.actor_user_id,
      actor_persona_id: args.actor_persona_id ?? null,
    });
  }

  return updated;
}

/**
 * Cross-tenant search via the public view. Caller's tenant_id is not
 * a filter — that's the whole point of the marketplace. The adapter
 * routes this through `public_parcel_listings_v` (0260).
 */
export async function searchMarketplace(
  port: GeoParcelsPort,
  rawFilters: Partial<MarketplaceSearchFilters>,
): Promise<MarketplaceListing[]> {
  const parsed = MarketplaceSearchFiltersSchema.safeParse({
    limit: rawFilters.limit ?? 20,
    offset: rawFilters.offset ?? 0,
    ...rawFilters,
  });
  if (!parsed.success) {
    throw new GeoParcelsError(
      'INVALID_FILTERS',
      `search filters failed validation: ${parsed.error.message}`,
    );
  }
  // Price range sanity.
  if (
    parsed.data.min_price_minor_units != null &&
    parsed.data.max_price_minor_units != null &&
    parsed.data.min_price_minor_units > parsed.data.max_price_minor_units
  ) {
    throw new GeoParcelsError(
      'INVALID_FILTERS',
      'min_price_minor_units must be <= max_price_minor_units',
    );
  }
  return port.searchPublicListings(parsed.data);
}

export interface FileInquiryArgs {
  id: string;
  /** Tenant of the LISTING (not the inquirer). */
  listing_tenant_id: string;
  listing_id: string;
  inquirer_user_id: string;
  inquirer_tenant_id?: string | null;
  message?: string | null;
  contact_phone?: string | null;
}

export async function fileInquiry(
  port: GeoParcelsPort,
  args: FileInquiryArgs,
): Promise<MarketplaceInquiry> {
  const row: MarketplaceInquiry = {
    id: args.id,
    tenant_id: args.listing_tenant_id,
    listing_id: args.listing_id,
    inquirer_user_id: args.inquirer_user_id,
    inquirer_tenant_id: args.inquirer_tenant_id ?? null,
    message: args.message ?? null,
    status: 'open',
    contact_phone: args.contact_phone ?? null,
  };

  const result = MarketplaceInquirySchema.safeParse(row);
  if (!result.success) {
    throw new GeoParcelsError(
      'INVALID_INQUIRY',
      `inquiry failed validation: ${result.error.message}`,
    );
  }

  return port.insertInquiry(row);
}
