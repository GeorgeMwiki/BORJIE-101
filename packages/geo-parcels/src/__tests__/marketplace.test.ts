import { describe, expect, it } from 'vitest';

import { captureLandArea } from '../land-area-capture.js';
import { subdivideParcel } from '../subdivide.js';
import {
  fileInquiry,
  publishListing,
  searchMarketplace,
  updateListingStatus,
} from '../marketplace.js';
import { GeoParcelsError } from '../types.js';
import {
  InMemoryPort,
  TEST_CHILD_LL,
  TEST_CHILD_UR,
  TEST_LAND_AREA_POLYGON,
} from './in-memory-port.js';

async function setupTenantAWithListing(port: InMemoryPort, opts?: {
  publish?: boolean;
  visiblePublicly?: boolean;
}) {
  // Tenant A: capture + subdivide + publish.
  await captureLandArea(port, {
    id: 'la-A',
    tenant_id: 'tenant-A',
    display_name: 'Plot Alpha',
    boundary_polygon: TEST_LAND_AREA_POLYGON,
    jurisdiction: 'TZ',
    region: 'Dar es Salaam',
    captured_via: 'gps_walk',
    captured_by_user_id: 'user-A',
  });
  const [parcel] = await subdivideParcel(port, {
    tenant_id: 'tenant-A',
    parent_kind: 'land_area',
    parent_id: 'la-A',
    parent_boundary_polygon: TEST_LAND_AREA_POLYGON,
    land_area_id: 'la-A',
    children: [
      {
        id: 'parcel-A-1',
        display_name: 'A-1',
        boundary_polygon: TEST_CHILD_LL,
        zoning: 'residential',
      },
    ],
    actor_user_id: 'user-A',
  });

  await publishListing(port, {
    id: 'listing-1',
    tenant_id: 'tenant-A',
    listed_by_user_id: 'user-A',
    parcel_id: parcel!.id,
    listing_kind: 'sale',
    title: 'A-1 sale',
    description: '0.5 acre residential plot in Dar',
    asking_price_minor_units: 15_000_000_000,
    currency_code: 'TZS',
    publish_immediately: opts?.publish ?? true,
    listing_visible_publicly: opts?.visiblePublicly ?? true,
    image_urls: ['https://cdn.example/p1.jpg'],
  });
  return parcel!;
}

describe('publishListing', () => {
  it('persists a draft by default', async () => {
    const port = new InMemoryPort();
    const listing = await publishListing(port, {
      id: 'l1',
      tenant_id: 't1',
      listed_by_user_id: 'u1',
      parcel_id: 'p1',
      listing_kind: 'sale',
      title: 'Draft',
      description: 'Test',
    });
    expect(listing.listing_status).toBe('draft');
  });

  it('publishes immediately when publish_immediately=true', async () => {
    const port = new InMemoryPort();
    const listing = await publishListing(port, {
      id: 'l2',
      tenant_id: 't1',
      listed_by_user_id: 'u1',
      parcel_id: 'p1',
      listing_kind: 'sale',
      title: 'Active',
      description: 'Test',
      publish_immediately: true,
    });
    expect(listing.listing_status).toBe('active');
  });

  it('rejects when neither parcel_id nor land_area_id supplied', async () => {
    const port = new InMemoryPort();
    await expect(
      publishListing(port, {
        id: 'l3',
        tenant_id: 't1',
        listed_by_user_id: 'u1',
        listing_kind: 'sale',
        title: 'Bad',
        description: 'No subject',
      }),
    ).rejects.toMatchObject({ code: 'NO_SUBJECT' });
  });

  it('rejects when price supplied without currency_code', async () => {
    const port = new InMemoryPort();
    await expect(
      publishListing(port, {
        id: 'l4',
        tenant_id: 't1',
        listed_by_user_id: 'u1',
        parcel_id: 'p1',
        listing_kind: 'sale',
        title: 'Bad',
        description: 'priced',
        asking_price_minor_units: 1000,
      }),
    ).rejects.toMatchObject({ code: 'NO_CURRENCY' });
  });

  it('rejects currency_code that is not 3 chars', async () => {
    const port = new InMemoryPort();
    await expect(
      publishListing(port, {
        id: 'l5',
        tenant_id: 't1',
        listed_by_user_id: 'u1',
        parcel_id: 'p1',
        listing_kind: 'sale',
        title: 'Bad',
        description: 'priced',
        asking_price_minor_units: 1000,
        currency_code: 'KENYAN',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });
});

describe('searchMarketplace — cross-tenant via public view', () => {
  it('tenant B sees tenant A\'s active+public listing', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);

    // Simulating tenant B's browse — searchMarketplace doesn't take a
    // tenant_id filter; the public view bypasses tenant isolation.
    const results = await searchMarketplace(port, {});
    expect(results).toHaveLength(1);
    expect(results[0]?.tenant_id).toBe('tenant-A');
  });

  it('tenant B cannot see tenant A\'s DRAFT listings', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port, { publish: false });
    const results = await searchMarketplace(port, {});
    expect(results).toHaveLength(0);
  });

  it('tenant B cannot see tenant A\'s non-public listings', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port, { publish: true, visiblePublicly: false });
    const results = await searchMarketplace(port, {});
    expect(results).toHaveLength(0);
  });

  it('tenant B cannot MUTATE tenant A\'s listing (RLS isolation on base table)', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);
    // The in-memory port enforces tenant isolation for getListing/updateListing.
    await expect(
      port.updateListing('listing-1', 'tenant-B', { title: 'hacked' }),
    ).rejects.toThrow(/not found/);
    const owner = await port.getListing('listing-1', 'tenant-A');
    expect(owner?.title).toBe('A-1 sale');
  });

  it('filters by jurisdiction', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);
    const tz = await searchMarketplace(port, { jurisdiction: 'TZ' });
    expect(tz).toHaveLength(1);
    const ke = await searchMarketplace(port, { jurisdiction: 'KE' });
    expect(ke).toHaveLength(0);
  });

  it('filters by price range', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);
    const cheap = await searchMarketplace(port, {
      max_price_minor_units: 1_000_000,
    });
    expect(cheap).toHaveLength(0);
    const inRange = await searchMarketplace(port, {
      min_price_minor_units: 10_000_000_000,
      max_price_minor_units: 20_000_000_000,
    });
    expect(inRange).toHaveLength(1);
  });

  it('rejects min > max price', async () => {
    const port = new InMemoryPort();
    await expect(
      searchMarketplace(port, {
        min_price_minor_units: 1000,
        max_price_minor_units: 500,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FILTERS' });
  });

  it('rejects an invalid filter (bad jurisdiction code)', async () => {
    const port = new InMemoryPort();
    await expect(
      searchMarketplace(port, { jurisdiction: 'TZA' }),
    ).rejects.toMatchObject({ code: 'INVALID_FILTERS' });
  });

  it('filters by zoning', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);
    const residential = await searchMarketplace(port, { zoning: 'residential' });
    expect(residential).toHaveLength(1);
    const industrial = await searchMarketplace(port, { zoning: 'industrial' });
    expect(industrial).toHaveLength(0);
  });

  it('filters by bounding box', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);
    const inBbox = await searchMarketplace(port, {
      bounding_box: {
        min_lng: 39.270,
        min_lat: -6.821,
        max_lng: 39.272,
        max_lat: -6.819,
      },
    });
    expect(inBbox).toHaveLength(1);
    const outBbox = await searchMarketplace(port, {
      bounding_box: {
        min_lng: 0,
        min_lat: 0,
        max_lng: 1,
        max_lat: 1,
      },
    });
    expect(outBbox).toHaveLength(0);
  });
});

describe('updateListingStatus', () => {
  it('marks a listing as sold and stamps sold_at/sold_to_user_id', async () => {
    const port = new InMemoryPort();
    const parcel = await setupTenantAWithListing(port);
    const updated = await updateListingStatus(port, {
      listing_id: 'listing-1',
      tenant_id: 'tenant-A',
      next_status: 'sold',
      sold_to_user_id: 'buyer-1',
      actor_user_id: 'user-A',
    });
    expect(updated.listing_status).toBe('sold');
    expect(updated.sold_to_user_id).toBe('buyer-1');
    expect(updated.sold_at).toBeTruthy();

    // Activity log on parcel records the sale.
    const events = await port.listActivityLog(parcel.id, 'tenant-A');
    expect(events.map((e) => e.event_kind)).toContain('sold');
  });

  it('throws when listing does not exist for tenant', async () => {
    const port = new InMemoryPort();
    await expect(
      updateListingStatus(port, {
        listing_id: 'nope',
        tenant_id: 'tenant-A',
        next_status: 'active',
        actor_user_id: 'user-A',
      }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_FOUND' });
  });

  it('logs as listed when next status is active', async () => {
    const port = new InMemoryPort();
    const parcel = await setupTenantAWithListing(port, { publish: false });
    await updateListingStatus(port, {
      listing_id: 'listing-1',
      tenant_id: 'tenant-A',
      next_status: 'active',
      actor_user_id: 'user-A',
    });
    const events = await port.listActivityLog(parcel.id, 'tenant-A');
    expect(events.map((e) => e.event_kind)).toContain('listed');
  });

  it('logs as status_changed for other transitions (paused/expired)', async () => {
    const port = new InMemoryPort();
    const parcel = await setupTenantAWithListing(port);
    await updateListingStatus(port, {
      listing_id: 'listing-1',
      tenant_id: 'tenant-A',
      next_status: 'paused',
      actor_user_id: 'user-A',
    });
    const events = await port.listActivityLog(parcel.id, 'tenant-A');
    expect(events.map((e) => e.event_kind)).toContain('status_changed');
  });
});

describe('fileInquiry — cross-tenant', () => {
  it('records inquiry under the LISTING\'s tenant', async () => {
    const port = new InMemoryPort();
    await setupTenantAWithListing(port);

    // Tenant B's user discovers the listing via the public view and inquires.
    const inquiry = await fileInquiry(port, {
      id: 'inq-1',
      listing_tenant_id: 'tenant-A',
      listing_id: 'listing-1',
      inquirer_user_id: 'user-B',
      inquirer_tenant_id: 'tenant-B',
      message: 'I am interested in this plot.',
      contact_phone: '+255700000000',
    });
    expect(inquiry.tenant_id).toBe('tenant-A');
    expect(inquiry.inquirer_tenant_id).toBe('tenant-B');
    expect(inquiry.status).toBe('open');

    // Listing owner (tenant-A) sees the inquiry via their normal RLS path.
    const inboxA = await port.listInquiriesForListing('listing-1', 'tenant-A');
    expect(inboxA).toHaveLength(1);
    // Tenant-B does NOT see it via their RLS path.
    const inboxB = await port.listInquiriesForListing('listing-1', 'tenant-B');
    expect(inboxB).toHaveLength(0);
  });

  it('rejects an inquiry with invalid status (via internal validation)', async () => {
    const port = new InMemoryPort();
    await expect(
      fileInquiry(port, {
        id: '',
        listing_tenant_id: 'tenant-A',
        listing_id: 'listing-1',
        inquirer_user_id: 'user-B',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });
});
