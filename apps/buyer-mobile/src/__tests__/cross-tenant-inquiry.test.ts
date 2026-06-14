import { describe, expect, it } from 'vitest'

// NOTE: import the PURE helpers directly (not `@/api/inquiries`, which pulls
// `@/api/client` → expo-secure-store and trips the vitest rollup parser —
// same constraint as src/__tests__/bid-messaging.test.ts).
import { isCrossTenantListing } from '../marketplace/crossTenant'
import {
  toRaiseInquiryPayload,
  mapBuyerInquiry,
  type GatewayInquiryRow,
} from '../marketplace/inquiryWire'
import {
  parseProjectedBuyerTabs,
  resolveProjectedBuyerTabs,
} from '../marketplace/buyerTabProjection'

const SELLER = 'tnt_estate_1'
const BUYER = 'tnt_test_org_1'

describe('KI-006 — isCrossTenantListing (hide bid → show inquiry)', () => {
  it('treats a listing from another seller tenant as cross-tenant', () => {
    expect(isCrossTenantListing({ sellerTenantId: SELLER }, BUYER)).toBe(true)
  })

  it('treats the buyer-own tenant listing as biddable (intra-tenant)', () => {
    expect(isCrossTenantListing({ sellerTenantId: BUYER }, BUYER)).toBe(false)
  })

  it('FAILS CLOSED to cross-tenant when the listing seller tenant is unknown', () => {
    expect(isCrossTenantListing({ sellerTenantId: undefined }, BUYER)).toBe(true)
    expect(isCrossTenantListing({ sellerTenantId: '' }, BUYER)).toBe(true)
  })

  it('FAILS CLOSED to cross-tenant when the buyer tenant is unknown', () => {
    expect(isCrossTenantListing({ sellerTenantId: SELLER }, null)).toBe(true)
    expect(isCrossTenantListing({ sellerTenantId: SELLER }, undefined)).toBe(true)
    expect(isCrossTenantListing({ sellerTenantId: SELLER }, '')).toBe(true)
  })
})

describe('KI-007 — toRaiseInquiryPayload (exact gateway body shape)', () => {
  it('posts exactly { listingId, message } and nothing else', () => {
    const payload = toRaiseInquiryPayload({
      listingId: 'lst_abc',
      message: 'Is this still available?',
    })
    expect(payload).toEqual({
      listingId: 'lst_abc',
      message: 'Is this still available?',
    })
    expect(Object.keys(payload).sort()).toEqual(['listingId', 'message'])
  })

  it('trims surrounding whitespace from the message', () => {
    expect(
      toRaiseInquiryPayload({ listingId: 'lst_x', message: '  hello  ' }).message,
    ).toBe('hello')
  })
})

describe('KI-007 — mapBuyerInquiry (response gated on delivery)', () => {
  it('surfaces the seller reply only when answered (delivered)', () => {
    const row: GatewayInquiryRow = {
      id: 'frun_1',
      state: 'delivered',
      subjectRef: 'lst_abc',
      payload: { message: 'Available?', listingTitle: 'Gold doré 2kg' },
      response: { message: 'Yes, ready to ship.' },
      answered: true,
      createdAt: '2026-06-14T10:00:00Z',
    }
    const out = mapBuyerInquiry(row)
    expect(out.answered).toBe(true)
    expect(out.response).toBe('Yes, ready to ship.')
    expect(out.listingTitle).toBe('Gold doré 2kg')
    expect(out.message).toBe('Available?')
  })

  it('NEVER leaks an undelivered response even if the row carries one', () => {
    const row: GatewayInquiryRow = {
      id: 'frun_2',
      state: 'awaiting_owner_approval',
      payload: { message: 'Price?', listingTitle: null },
      response: { message: 'draft not yet approved' },
      answered: false,
      createdAt: '2026-06-14T11:00:00Z',
    }
    const out = mapBuyerInquiry(row)
    expect(out.answered).toBe(false)
    expect(out.response).toBeNull()
  })
})

describe('KI-007 — resolveProjectedBuyerTabs (inquiry_respond → inquiries screen)', () => {
  it('maps inquiry_respond onto the inquiries tab and keeps the owner label', () => {
    const raw = [
      {
        id: 'tab_inq',
        kind: 'inquiry_respond',
        label: 'Buyer Inquiries',
        organizationId: 'org_1',
        tenantId: SELLER,
        tenantName: 'Geita Estate',
        origin: 'owner-spawned',
      },
    ]
    const parsed = parseProjectedBuyerTabs(raw)
    expect(parsed).toHaveLength(1)
    const resolution = resolveProjectedBuyerTabs(parsed)
    expect(resolution.resolved).toEqual([
      {
        id: 'tab_inq',
        kind: 'inquiry_respond',
        label: 'Buyer Inquiries',
        screen: 'inquiries',
      },
    ])
    expect(resolution.skippedKinds).toEqual([])
  })

  it('skips unknown kinds (honest-degrade) without crashing', () => {
    const parsed = parseProjectedBuyerTabs([
      {
        id: 't1',
        kind: 'some_future_kind',
        label: 'Future',
        organizationId: 'o',
        tenantId: SELLER,
        tenantName: null,
        origin: 'owner-spawned',
      },
    ])
    const resolution = resolveProjectedBuyerTabs(parsed)
    expect(resolution.resolved).toEqual([])
    expect(resolution.skippedKinds).toEqual(['some_future_kind'])
  })

  it('drops malformed projection entries so they can never crash the shell', () => {
    expect(parseProjectedBuyerTabs('not-an-array')).toEqual([])
    expect(
      parseProjectedBuyerTabs([{ id: 'x' /* missing required fields */ }]),
    ).toEqual([])
  })
})
