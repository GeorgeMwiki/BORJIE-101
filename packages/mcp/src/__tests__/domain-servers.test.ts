/**
 * Pre-shipped domain MCP servers — wired against in-memory port adapters.
 *
 * Each server gets 2-3 tool invocations exercised end-to-end through the
 * client/server framework so we cover dispatch + zod validation + tenant
 * scoping + result shape.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createInMemoryTransportPair } from '../transport/in-memory.js';
import { createMCPClient } from '../client/client.js';
import type { ToolCallResponse } from '../types.js';
import {
  createPropertyMCPServer,
  createPaymentsMCPServer,
  createMaintenanceMCPServer,
  createDocumentsMCPServer,
  createGeoMCPServer,
  type PropertyPort,
  type PaymentsPort,
  type MaintenancePort,
  type DocumentsPort,
  type GeoPort,
} from '../domain-servers/index.js';

function parsed<T>(result: ToolCallResponse): T {
  const first = result.content[0] as { type: string; text?: string };
  if (first.type !== 'text' || !first.text) {
    throw new Error('Expected first content block to be text');
  }
  return JSON.parse(first.text) as T;
}

const TENANT = 't-acme';
const SESSION = { sessionId: 's-1', tenantId: TENANT };

describe('PropertyMCPServer', () => {
  const PROP_ID = randomUUID();
  const UNIT_ID = randomUUID();
  const LEASEHOLDER_ID = randomUUID();

  function makePort(): PropertyPort {
    const properties = new Map<string, Awaited<ReturnType<PropertyPort['getProperty']>>>([
      [
        PROP_ID,
        {
          id: PROP_ID,
          tenantId: TENANT,
          name: 'Acme Block A',
          addressLine1: '1 Acme Way',
          city: 'Dar',
          countryCode: 'TZ',
          unitsCount: 1,
        },
      ],
    ]);
    return {
      async listProperties(tenantId) {
        if (tenantId !== TENANT) return [];
        return Array.from(properties.values()).filter((p): p is NonNullable<typeof p> => p !== null);
      },
      async getProperty(tenantId, id) {
        if (tenantId !== TENANT) return null;
        return properties.get(id) ?? null;
      },
      async createProperty(tenantId, data) {
        const id = randomUUID();
        const out = { id, tenantId, unitsCount: 0, ...data };
        properties.set(id, out);
        return out;
      },
      async updateProperty(tenantId, id, patch) {
        const existing = properties.get(id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...patch, id, tenantId };
        properties.set(id, updated);
        return updated;
      },
      async listUnits() {
        return [{ id: UNIT_ID, propertyId: PROP_ID, tenantId: TENANT, label: 'A1', bedrooms: 2, status: 'occupied' as const }];
      },
      async listLeases() {
        return [];
      },
      async getTenantHistory(_t, lid) {
        if (lid !== LEASEHOLDER_ID) return [];
        return [];
      },
    };
  }

  it('list_properties returns the tenant\'s properties', async () => {
    const server = createPropertyMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('list_properties', {});
    const items = parsed<Array<{ id: string }>>(out);
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe(PROP_ID);
    await client.close();
  });

  it('get_property fetches by id', async () => {
    const server = createPropertyMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('get_property', { propertyId: PROP_ID });
    const item = parsed<{ id: string; name: string }>(out);
    expect(item.name).toBe('Acme Block A');
    await client.close();
  });

  it('create_property accepts a new entry', async () => {
    const server = createPropertyMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('create_property', {
      name: 'B Building',
      addressLine1: '2 Acme Way',
      city: 'Dar',
      countryCode: 'TZ',
    });
    const item = parsed<{ id: string; name: string }>(out);
    expect(item.name).toBe('B Building');
    await client.close();
  });
});

describe('PaymentsMCPServer', () => {
  const LEASE_ID = randomUUID();

  function makePort(): PaymentsPort {
    return {
      async getRentLedger(t, leaseId) {
        if (t !== TENANT || leaseId !== LEASE_ID) return [];
        return [{
          id: 'le-1',
          tenantId: t,
          leaseId,
          amountMinor: 100_000,
          currency: 'TZS',
          kind: 'rent-charge' as const,
          date: '2026-05-01',
        }];
      },
      async recordPayment(t, input) {
        return {
          id: randomUUID(),
          tenantId: t,
          leaseId: input.leaseId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          kind: 'rent-payment' as const,
          date: input.date,
          ...(input.note !== undefined ? { note: input.note } : {}),
        };
      },
      async listArrears() {
        return [];
      },
      async computeLateFee(_t, leaseId) {
        return { leaseId, feeMinor: 5_000, currency: 'TZS' };
      },
    };
  }

  it('get_rent_ledger returns ledger entries', async () => {
    const server = createPaymentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('get_rent_ledger', { leaseId: LEASE_ID });
    const ledger = parsed<Array<{ leaseId: string; amountMinor: number }>>(out);
    expect(ledger[0]?.leaseId).toBe(LEASE_ID);
    expect(ledger[0]?.amountMinor).toBe(100_000);
    await client.close();
  });

  it('record_payment validates + returns the entry', async () => {
    const server = createPaymentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('record_payment', {
      leaseId: LEASE_ID,
      amountMinor: 50_000,
      currency: 'TZS',
      date: '2026-05-15',
    });
    const entry = parsed<{ amountMinor: number; kind: string }>(out);
    expect(entry.amountMinor).toBe(50_000);
    expect(entry.kind).toBe('rent-payment');
    await client.close();
  });

  it('record_payment rejects negative amounts via zod', async () => {
    const server = createPaymentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    await expect(
      client.callTool('record_payment', {
        leaseId: LEASE_ID,
        amountMinor: -10,
        currency: 'TZS',
        date: '2026-05-15',
      }),
    ).rejects.toThrow(/Invalid arguments/);
    await client.close();
  });
});

describe('MaintenanceMCPServer', () => {
  const TICKET_ID = randomUUID();
  const PROP_ID = randomUUID();
  const TECH_ID = randomUUID();

  function makePort(): MaintenancePort {
    const tickets = new Map<string, Awaited<ReturnType<MaintenancePort['createTicket']>>>([
      [
        TICKET_ID,
        {
          id: TICKET_ID,
          tenantId: TENANT,
          propertyId: PROP_ID,
          title: 'Leaky tap',
          description: 'in unit 3B',
          status: 'open' as const,
          priority: 'normal' as const,
          createdAt: new Date().toISOString(),
        },
      ],
    ]);
    return {
      async listOpenTickets() {
        return Array.from(tickets.values()).filter((t) => t.status === 'open');
      },
      async createTicket(t, input) {
        const id = randomUUID();
        const ticket = {
          id,
          tenantId: t,
          ...input,
          status: 'open' as const,
          createdAt: new Date().toISOString(),
        };
        tickets.set(id, ticket);
        return ticket;
      },
      async assignTechnician(t, ticketId, technicianId) {
        const existing = tickets.get(ticketId);
        if (!existing) throw new Error('not-found');
        const next = { ...existing, status: 'assigned' as const, assignedTechId: technicianId };
        tickets.set(ticketId, next);
        return next;
      },
      async recordCompletion(t, ticketId) {
        const existing = tickets.get(ticketId);
        if (!existing) throw new Error('not-found');
        const next = { ...existing, status: 'completed' as const, completedAt: new Date().toISOString() };
        tickets.set(ticketId, next);
        return next;
      },
    };
  }

  it('list_open_tickets surfaces tickets in open state', async () => {
    const server = createMaintenanceMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('list_open_tickets', {});
    const items = parsed<Array<{ id: string }>>(out);
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe(TICKET_ID);
    await client.close();
  });

  it('assign_technician transitions to assigned', async () => {
    const server = createMaintenanceMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('assign_technician', {
      ticketId: TICKET_ID,
      technicianId: TECH_ID,
    });
    const ticket = parsed<{ status: string; assignedTechId: string }>(out);
    expect(ticket.status).toBe('assigned');
    expect(ticket.assignedTechId).toBe(TECH_ID);
    await client.close();
  });

  it('record_completion marks completed', async () => {
    const server = createMaintenanceMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('record_completion', {
      ticketId: TICKET_ID,
      note: 'all done',
    });
    const ticket = parsed<{ status: string }>(out);
    expect(ticket.status).toBe('completed');
    await client.close();
  });
});

describe('DocumentsMCPServer', () => {
  const DOC_ID = randomUUID();

  function makePort(): DocumentsPort {
    const docs = new Map([[
      DOC_ID,
      {
        id: DOC_ID,
        tenantId: TENANT,
        name: 'lease-2024.pdf',
        mimeType: 'application/pdf',
        bytesUrl: 'memory://documents/lease-2024.pdf',
        size: 1024,
        uploadedAt: new Date().toISOString(),
      },
    ]]);
    return {
      async listDocuments() {
        return Array.from(docs.values());
      },
      async getDocument(_t, id) {
        return docs.get(id) ?? null;
      },
      async uploadDocument(t, input) {
        const id = randomUUID();
        const size = typeof input.content === 'string' ? input.content.length : input.content.byteLength;
        const doc = {
          id,
          tenantId: t,
          name: input.name,
          mimeType: input.mimeType,
          bytesUrl: `memory://documents/${id}`,
          size,
          uploadedAt: new Date().toISOString(),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        };
        docs.set(id, doc);
        return doc;
      },
      async chatWithDocument(_t, _id, question) {
        return { answer: `Re: ${question} — see clause 4.2`, citations: ['p.3'] };
      },
    };
  }

  it('list_documents enumerates the tenant\'s documents', async () => {
    const server = createDocumentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('list_documents', {});
    const items = parsed<Array<{ id: string }>>(out);
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe(DOC_ID);
    await client.close();
  });

  it('upload_document records the new file', async () => {
    const server = createDocumentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('upload_document', {
      name: 'note.txt',
      mimeType: 'text/plain',
      content: 'hello, MCP',
    });
    const doc = parsed<{ name: string; mimeType: string }>(out);
    expect(doc.name).toBe('note.txt');
    expect(doc.mimeType).toBe('text/plain');
    await client.close();
  });

  it('chat_with_document returns answer + citations', async () => {
    const server = createDocumentsMCPServer({ db: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('chat_with_document', {
      documentId: DOC_ID,
      question: 'What is the notice period?',
    });
    const ans = parsed<{ answer: string; citations: Array<string> }>(out);
    expect(ans.answer).toMatch(/notice/i);
    expect(ans.citations.length).toBe(1);
    await client.close();
  });
});

describe('GeoMCPServer', () => {
  const PARCEL_ID = randomUUID();

  function makePort(): GeoPort {
    return {
      async findNearestParcels(t, point, limit) {
        return [{
          id: PARCEL_ID,
          tenantId: t,
          geoJson: { type: 'Point', coordinates: [point.lng, point.lat] },
          distanceMeters: 42,
        }].slice(0, limit ?? 10);
      },
      async getParcelHistory(t, parcelId) {
        if (parcelId !== PARCEL_ID) return null;
        return {
          id: parcelId,
          tenantId: t,
          geoJson: { type: 'Polygon', coordinates: [] },
          historyEvents: [{ date: '2024-01-15', event: 'subdivided' }],
        };
      },
      async listSegments() {
        return [{ id: 'seg-1', name: 'Acme St', kind: 'street' as const }];
      },
    };
  }

  it('find_nearest_parcels validates lat/lng bounds', async () => {
    const server = createGeoMCPServer({ kg: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    await expect(
      client.callTool('find_nearest_parcels', { lat: 999, lng: 0 }),
    ).rejects.toThrow(/Invalid arguments/);
    await client.close();
  });

  it('find_nearest_parcels returns parcels for valid coords', async () => {
    const server = createGeoMCPServer({ kg: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('find_nearest_parcels', { lat: 1, lng: 1, limit: 5 });
    const parcels = parsed<Array<{ id: string; distanceMeters: number }>>(out);
    expect(parcels[0]?.id).toBe(PARCEL_ID);
    expect(parcels[0]?.distanceMeters).toBe(42);
    await client.close();
  });

  it('list_segments returns segment metadata', async () => {
    const server = createGeoMCPServer({ kg: makePort() });
    const pair = createInMemoryTransportPair();
    server.attach(pair.server, SESSION);
    const client = createMCPClient({ transport: pair.client });
    const out = await client.callTool('list_segments', { kind: 'street' });
    const segs = parsed<Array<{ id: string; kind: string }>>(out);
    expect(segs[0]?.kind).toBe('street');
    await client.close();
  });
});
