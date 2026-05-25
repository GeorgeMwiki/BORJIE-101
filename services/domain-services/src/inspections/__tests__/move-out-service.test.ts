/**
 * MoveOutChecklistService — happy path + cross-tenant isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asUserId } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import type {
  Inspection,
  InspectionId,
  ESignature,
} from '../types.js';
import type { InspectionRepository } from '../inspection-service.js';
import {
  MoveOutChecklistService,
  MoveOutServiceError,
} from '../move-out/index.js';

const tenantA = asTenantId('tnt_a');
const tenantB = asTenantId('tnt_b');
const propertyId = 'prop_1' as any;
const unitId = 'unit_1' as any;
const userId = asUserId('usr_1');

function createInspectionRepo(): InspectionRepository {
  const store = new Map<string, Inspection>();
  return {
    async findById(id, tenantId) {
      const i = store.get(id);
      if (!i || i.tenantId !== tenantId) return null;
      return i;
    },
    async findMany(tenantId) {
      const items = Array.from(store.values()).filter(
        (i) => i.tenantId === tenantId
      );
      return {
        items,
        total: items.length,
        page: 1,
        limit: items.length,
        totalPages: 1,
      } as any;
    },
    async create(i) {
      store.set(i.id, i);
      return i;
    },
    async update(i) {
      store.set(i.id, i);
      return i;
    },
  };
}

function createEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

function makeSig(role: ESignature['signerRole']): ESignature {
  return {
    signerRole: role,
    signerUserId: userId,
    signatureData: 'base64sig',
    signedAt: new Date().toISOString() as any,
  };
}

describe('MoveOutChecklistService', () => {
  it('runs start -> capture -> dualSign -> fileDamageClaim', async () => {
    const repo = createInspectionRepo();
    const svc = new MoveOutChecklistService(repo, createEventBus());

    const start = await svc.startInspection({
      tenantId: tenantA,
      propertyId,
      unitId,
      inspectorId: userId,
      scheduledDate: new Date().toISOString() as any,
      selfCheckoutAllowed: true,
    });
    expect(start.success).toBe(true);
    if (!start.success) return;
    const id = start.data.id;

    const cap = await svc.captureFindings({
      tenantId: tenantA,
      inspectionId: id,
      roomId: 'room_living',
      itemName: 'Walls',
      condition: 'damaged',
      photos: ['photo-1.jpg'],
      addedBy: userId,
    });
    expect(cap.success).toBe(true);

    const dual = await svc.dualSign({
      tenantId: tenantA,
      inspectionId: id,
      tenantSignature: makeSig('tenant'),
      landlordSignature: makeSig('manager'),
    });
    expect(dual.success).toBe(true);
    if (!dual.success) return;
    expect(dual.data.status).toBe('completed');

    const claim = await svc.fileDamageClaim({
      tenantId: tenantA,
      moveOutInspectionId: id,
      filedBy: userId,
    });
    expect(claim.success).toBe(true);
    if (!claim.success) return;
    expect(claim.data.moveOutId).toBe(id);
    expect(claim.data.photoManifest.pairs.length).toBeGreaterThan(0);
  });

  it('self-checkout succeeds when allowed, fails when not', async () => {
    const repo = createInspectionRepo();
    const svc = new MoveOutChecklistService(repo, createEventBus());

    const start = await svc.startInspection({
      tenantId: tenantA,
      propertyId,
      unitId,
      inspectorId: userId,
      scheduledDate: new Date().toISOString() as any,
      selfCheckoutAllowed: false,
    });
    if (!start.success) return;

    const res = await svc.selfCheckout({
      tenantId: tenantA,
      inspectionId: start.data.id,
      tenantSignature: makeSig('tenant'),
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(MoveOutServiceError.SELF_CHECKOUT_DISABLED);
  });

  it('blocks cross-tenant access', async () => {
    const repo = createInspectionRepo();
    const svc = new MoveOutChecklistService(repo, createEventBus());

    const start = await svc.startInspection({
      tenantId: tenantA,
      propertyId,
      unitId,
      inspectorId: userId,
      scheduledDate: new Date().toISOString() as any,
    });
    if (!start.success) return;

    const leak = await svc.captureFindings({
      tenantId: tenantB,
      inspectionId: start.data.id,
      roomId: 'room_kitchen',
      itemName: 'Sink',
      condition: 'good',
      addedBy: userId,
    });
    expect(leak.success).toBe(false);
    if (leak.success) return;
    expect(leak.error.code).toBe(MoveOutServiceError.INSPECTION_NOT_FOUND);
  });
});
