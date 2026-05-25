/**
 * create-lease-application.test.ts — exercises the ESTATE handler
 * end-to-end with fake ports.
 *
 * The contract these tests pin down:
 *
 *   * Money goes through the ledger port (NEVER direct mutation).
 *   * A canonical PERSON is created when the resolver missed.
 *   * An audit-chain row is appended, anchored to the source capture.
 *   * The notification port is hit with the ESTATE realtime channel.
 *   * The handler rejects an invalid payload.
 *   * The handler reuses an existing PERSON when canonical_entity_id
 *     resolves.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLeaseApplicationHandler,
  CreateLeaseApplicationPayloadSchema,
  type CreateLeaseApplicationDeps,
  type CreateLeaseApplicationContext,
  type CreateLeaseApplicationPayload,
} from '../templates/estate/handlers/create-lease-application.js';

function makeFakeDeps(): {
  deps: CreateLeaseApplicationDeps;
  findById: ReturnType<typeof vi.fn>;
  createPerson: ReturnType<typeof vi.fn>;
  draftApplication: ReturnType<typeof vi.fn>;
  ledgerPost: ReturnType<typeof vi.fn>;
  auditAppend: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  const findById = vi.fn().mockResolvedValue(null);
  const createPerson = vi
    .fn()
    .mockResolvedValue({ id: 'ce_person_new' });
  const draftApplication = vi
    .fn()
    .mockResolvedValue({ id: 'app_001' });
  const ledgerPost = vi
    .fn()
    .mockResolvedValue({ id: 'ledger_entry_001' });
  const auditAppend = vi
    .fn()
    .mockResolvedValue({ id: 'audit_chain_001' });
  const notify = vi.fn().mockResolvedValue(undefined);

  const deps: CreateLeaseApplicationDeps = {
    coreEntity: {
      findById,
      createPerson,
    },
    ledger: { post: ledgerPost },
    applications: { draftApplication },
    auditChain: { append: auditAppend },
    notifications: { publish: notify },
  };

  return { deps, findById, createPerson, draftApplication, ledgerPost, auditAppend, notify };
}

const ctx: CreateLeaseApplicationContext = {
  tenantId: 'tnt_trc',
  moduleId: 'mod_estate_trc',
  proposalId: 'prop_001',
  sourceAuditChainId: 'audit_capture_001',
};

const payload: CreateLeaseApplicationPayload = {
  prospective_tenant: {
    canonical_entity_id: null,
    full_name: 'Jane Doe',
    contact_phone: '+255712345678',
    national_id: '19850101-12345-67890-12',
  },
  unit_id: 'unit_4b',
  desired_start_date: '2026-06-01',
  monthly_rent: { amount: 450000, currency_code: 'TZS' },
  proposed_term_months: 12,
  source: {
    capture_id: 'cap_001',
    message_id: 'msg_001',
    document_id: null,
  },
};

describe('createLeaseApplicationHandler — happy path', () => {
  it('creates a person, drafts the application, posts the deposit, and notifies', async () => {
    const { deps, ledgerPost, auditAppend, notify, createPerson, draftApplication } =
      makeFakeDeps();

    const result = await createLeaseApplicationHandler(payload, ctx, deps);

    expect(result.status).toBe('awaiting_screening');
    expect(result.application_id).toBe('app_001');
    expect(result.audit_chain_id).toBe('audit_chain_001');
    expect(result.tenant_entity_id).toBe('ce_person_new');
    expect(result.deposit_ledger_entry_id).toBe('ledger_entry_001');

    expect(createPerson).toHaveBeenCalledTimes(1);
    expect(draftApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tnt_trc',
        moduleId: 'mod_estate_trc',
        unitId: 'unit_4b',
        proposedTermMonths: 12,
      }),
    );
    expect(ledgerPost).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tnt_trc',
        amount: 450000,
        currencyCode: 'TZS',
        debitAccount: 'cash_clearing',
        creditAccount: 'tenant_deposits',
      }),
    );
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'estate.create_lease_application',
        parentHash: 'audit_capture_001',
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'tenant:tnt_trc:module:ESTATE:proposals',
      }),
    );
  });
});

describe('createLeaseApplicationHandler — entity resolution', () => {
  it('reuses an existing canonical PERSON when the resolver returns one', async () => {
    const { deps, findById, createPerson } = makeFakeDeps();
    findById.mockResolvedValue({
      id: 'ce_existing_jane',
      displayName: 'Jane Doe',
    });

    const result = await createLeaseApplicationHandler(
      {
        ...payload,
        prospective_tenant: {
          ...payload.prospective_tenant,
          canonical_entity_id: 'ce_existing_jane',
        },
      },
      ctx,
      deps,
    );

    expect(result.tenant_entity_id).toBe('ce_existing_jane');
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('creates a new PERSON when canonical_entity_id is null', async () => {
    const { deps, createPerson } = makeFakeDeps();
    await createLeaseApplicationHandler(payload, ctx, deps);
    expect(createPerson).toHaveBeenCalled();
  });
});

describe('createLeaseApplicationHandler — validation', () => {
  it('rejects a payload missing required fields', async () => {
    const { deps } = makeFakeDeps();
    const bad = { ...payload, unit_id: '' } as any;
    await expect(createLeaseApplicationHandler(bad, ctx, deps)).rejects.toThrow();
  });

  it('rejects an unsupported currency code', async () => {
    const { deps } = makeFakeDeps();
    const bad = {
      ...payload,
      monthly_rent: { amount: 100, currency_code: 'EUR' },
    } as any;
    await expect(createLeaseApplicationHandler(bad, ctx, deps)).rejects.toThrow();
  });

  it('rejects a non-positive amount', async () => {
    const { deps } = makeFakeDeps();
    const bad = {
      ...payload,
      monthly_rent: { amount: 0, currency_code: 'TZS' },
    } as any;
    await expect(createLeaseApplicationHandler(bad, ctx, deps)).rejects.toThrow();
  });

  it('rejects a term outside 1..120 months', async () => {
    const { deps } = makeFakeDeps();
    const bad = { ...payload, proposed_term_months: 150 } as any;
    await expect(createLeaseApplicationHandler(bad, ctx, deps)).rejects.toThrow();
  });
});

describe('CreateLeaseApplicationPayloadSchema', () => {
  it('parses a well-formed payload', () => {
    const parsed = CreateLeaseApplicationPayloadSchema.parse(payload);
    expect(parsed.unit_id).toBe('unit_4b');
  });
});
