import { describe, it, expect, beforeEach } from 'vitest';
import { LetterService, type LetterRequestRecord, type ILetterRepository } from '../letters/letter-service.js';
import { TextRenderer } from '../renderers/text-renderer.js';
import type { TenantId, UserId } from '@borjie/domain-models';

class InMemoryLetterRepo implements ILetterRepository {
  private readonly store = new Map<string, LetterRequestRecord>();
  async create(rec: LetterRequestRecord) { this.store.set(rec.id, rec); return rec; }
  async findById(id: string, tenantId: TenantId) {
    const rec = this.store.get(id);
    return rec && rec.tenantId === tenantId ? rec : null;
  }
  async update(rec: LetterRequestRecord) { this.store.set(rec.id, rec); return rec; }
}

describe('LetterService', () => {
  let svc: LetterService;
  let repo: InMemoryLetterRepo;
  const tenantId = 'ten_1' as TenantId;
  const userId = 'usr_1' as UserId;

  beforeEach(() => {
    repo = new InMemoryLetterRepo();
    svc = new LetterService({ repository: repo, renderer: new TextRenderer() });
  });

  it('creates a letter request in requested state', async () => {
    const result = await svc.createRequest({
      tenantId,
      letterType: 'residency_proof',
      requestedBy: userId,
      payload: { reason: 'KYC' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('requested');
      expect(result.value.letterType).toBe('residency_proof');
    }
  });

  it('drafts a letter and transitions to drafted', async () => {
    const create = await svc.createRequest({
      tenantId,
      letterType: 'residency_proof',
      requestedBy: userId,
      payload: {},
    });
    if (!create.ok) throw new Error('create failed');
    const drafted = await svc.draft(create.value.id, tenantId, {
      type: 'residency_proof',
      data: {
        letterReference: 'R-1',
        issueDate: '2026-04-18',
        tenantName: 'Jane Doe',
        propertyAddress: '1 Road',
        unitIdentifier: 'A',
        residentSince: '2023-01-01',
        landlordName: 'L',
      },
    });
    expect(drafted.ok).toBe(true);
    if (drafted.ok) {
      expect(drafted.value.status).toBe('drafted');
      expect(drafted.value.draftContent).toContain('Jane Doe');
    }
  });

  it('approve → issued transitions with an issued document id', async () => {
    const create = await svc.createRequest({
      tenantId, letterType: 'tenancy_confirmation', requestedBy: userId, payload: {},
    });
    if (!create.ok) throw new Error('fail');
    await svc.draft(create.value.id, tenantId, {
      type: 'tenancy_confirmation',
      data: {
        letterReference: 'T-1', issueDate: '2026-04-18',
        tenantName: 'J', propertyAddress: 'P', unitIdentifier: 'U',
        leaseStartDate: '2024-01-01', monthlyRent: 30000, currency: 'KES',
        landlordName: 'L',
      },
    });
    const approved = await svc.approve(create.value.id, tenantId, userId, 'doc_1');
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.status).toBe('issued');
      expect(approved.value.issuedDocumentId).toBe('doc_1');
    }
  });

  it('refuses to approve from non-drafted state', async () => {
    const create = await svc.createRequest({
      tenantId, letterType: 'tenancy_confirmation', requestedBy: userId, payload: {},
    });
    if (!create.ok) throw new Error('fail');
    const approved = await svc.approve(create.value.id, tenantId, userId, 'doc_x');
    expect(approved.ok).toBe(false);
  });

  it('download returns INVALID_STATE before issuance', async () => {
    const create = await svc.createRequest({
      tenantId, letterType: 'payment_confirmation', requestedBy: userId, payload: {},
    });
    if (!create.ok) throw new Error('fail');
    const dl = await svc.download(create.value.id, tenantId);
    expect(dl.ok).toBe(false);
  });
});
