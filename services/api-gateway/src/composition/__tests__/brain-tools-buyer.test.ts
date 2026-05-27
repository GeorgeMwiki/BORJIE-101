/**
 * Buyer-tools tests (T5_customer_concierge).
 *
 * Verifies:
 *   - Seven tools, all gated to buyer slug
 *   - Place-bid audits on success; cancel-bid audits on success
 *   - Invalid amount rejected by zod (currency required, amount positive)
 *   - Persona gating refuses an admin trying to place a bid
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  BUYER_TOOLS,
  type PersonaToolAuditEntry,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  buyerCancelBidTool,
  buyerPlaceBidTool,
} from '../brain-tools/buyer-tools';

function client(): PersonaToolHttpClient {
  return {
    async get<T>(): Promise<T> {
      return { listings: [], totalListings: 0 } as unknown as T;
    },
    async post<T>(): Promise<T> {
      return {
        bidId: 'bid-1',
        placedAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        withdrawnAt: '2026-01-01T01:00:00.000Z',
      } as unknown as T;
    },
  };
}

function gate(
  persona: string,
  audits: PersonaToolAuditEntry[],
): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => persona,
    httpClient: client(),
    auditSink: {
      async append(entry: PersonaToolAuditEntry) {
        audits.push(entry);
      },
    },
  };
}

function ctx() {
  return {
    tenant: { tenantId: 'tenant-buyer' } as never,
    actor: { id: 'buyer-1' } as never,
    persona: { id: 'p-b' } as never,
    threadId: 'th-1',
  };
}

describe('buyer-tools — surface', () => {
  it('registers exactly seven buyer tools', () => {
    expect(BUYER_TOOLS).toHaveLength(7);
  });

  it('every buyer tool is gated to T5_customer_concierge only', () => {
    for (const t of BUYER_TOOLS) {
      expect(t.personaSlugs).toEqual(['T5_customer_concierge']);
    }
  });

  it('write tools are exactly {place, cancel, kyc upload-atom}', () => {
    const writeIds = BUYER_TOOLS.filter((t) => t.isWrite).map((t) => t.id);
    expect(writeIds.sort()).toEqual([
      'mining.bids.cancel',
      'mining.bids.place',
      'mining.buyers.kyc.upload-atom',
    ]);
  });
});

describe('buyer-tools — execution', () => {
  it('places a bid with valid input and writes audit', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      buyerPlaceBidTool,
      gate('T5_customer_concierge', audits),
    );
    const result = await handler.execute(
      { parcelId: 'parcel-1', amount: 100_000, currency: 'TZS' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].toolId).toBe('mining.bids.place');
  });

  it('rejects place-bid with negative amount (zod fail)', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      buyerPlaceBidTool,
      gate('T5_customer_concierge', audits),
    );
    const result = await handler.execute(
      { parcelId: 'parcel-1', amount: -100, currency: 'TZS' },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(audits).toHaveLength(0);
  });

  it('cancels a bid and emits an audit entry', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      buyerCancelBidTool,
      gate('T5_customer_concierge', audits),
    );
    const result = await handler.execute(
      { bidId: 'bid-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].toolId).toBe('mining.bids.cancel');
  });

  it('refuses when an admin tries to place a buyer bid', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      buyerPlaceBidTool,
      gate('T2_admin_strategist', audits),
    );
    const result = await handler.execute(
      { parcelId: 'parcel-1', amount: 100, currency: 'TZS' },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe('denied');
  });
});
