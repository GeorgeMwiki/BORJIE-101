/**
 * Vendor registry — onboarding, KYC, status transitions.
 *
 * Each operation returns a NEW vendor object — no field is mutated in
 * place. The data port persists the new shape; the caller never holds
 * a stale reference because we always go through the public methods.
 *
 * Auditable transitions:
 *
 *   register(vendor)               → KYC `pending`
 *   submitKyc({ vendorId })        → KYC `submitted` (after checklist passes)
 *   approveKyc({ vendorId })       → KYC `approved` + statusReason cleared
 *   rejectKyc({ vendorId, reason }) → KYC `rejected` + reason recorded
 *   blacklist({ vendorId, reason })→ preferred='blacklisted' + statusReason
 */

import { z } from 'zod';
import type {
  ClockPort,
  KycDocument,
  KycDocumentType,
  ProcurementDataPort,
  Vendor,
  VendorCategory,
  VendorId,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';
import { kycRequirementsFor } from './jurisdictions.js';

const RegisterVendorSchema = z.object({
  tenantId: z.string().min(1),
  country: z.string().length(2),
  companyName: z.string().min(1).max(200),
  registrationNumber: z.string().min(1).max(80),
  taxId: z.string().min(1).max(80),
  categories: z.array(z.string()).min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().nullable().optional(),
});

export type RegisterVendorInput = z.infer<typeof RegisterVendorSchema>;

export interface VendorRegistry {
  registerVendor(input: RegisterVendorInput): Promise<Vendor>;
  attachKycDocument(args: {
    readonly vendorId: VendorId;
    readonly type: KycDocumentType;
    readonly fileUrl: string;
    readonly expiresAt?: string | null;
  }): Promise<KycDocument>;
  submitKyc(args: { readonly vendorId: VendorId }): Promise<{
    readonly vendor: Vendor;
    readonly missingDocuments: ReadonlyArray<KycDocumentType>;
  }>;
  approveKyc(args: { readonly vendorId: VendorId; readonly approverId: string }): Promise<Vendor>;
  rejectKyc(args: {
    readonly vendorId: VendorId;
    readonly approverId: string;
    readonly reason: string;
  }): Promise<Vendor>;
  blacklistVendor(args: {
    readonly vendorId: VendorId;
    readonly reason: string;
  }): Promise<Vendor>;
  setPreferred(args: { readonly vendorId: VendorId }): Promise<Vendor>;
  rateVendor(args: { readonly vendorId: VendorId; readonly rating: number }): Promise<Vendor>;
}

export interface VendorRegistryDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
}

export function createVendorRegistry(deps: VendorRegistryDeps): VendorRegistry {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async registerVendor(rawInput) {
      const input = RegisterVendorSchema.parse(rawInput);
      const id: VendorId = `ven_${idFactory()}`;
      const vendor: Vendor = {
        id,
        tenantId: input.tenantId,
        country: input.country.toUpperCase(),
        companyName: input.companyName,
        registrationNumber: input.registrationNumber,
        taxId: input.taxId,
        kycStatus: 'pending',
        categories: input.categories as ReadonlyArray<VendorCategory>,
        bankDetails: null,
        insuranceExpiresAt: null,
        certifications: [],
        rating: null,
        preferredStatus: 'standard',
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone ?? null,
        createdAt: clock.now().toISOString(),
        kycDecidedAt: null,
        statusReason: null,
      };
      await port.insertVendor(vendor);
      return vendor;
    },

    async attachKycDocument(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      const doc: KycDocument = {
        id: `kyc_${idFactory()}`,
        vendorId: vendor.id,
        type: args.type,
        fileUrl: args.fileUrl,
        uploadedAt: clock.now().toISOString(),
        expiresAt: args.expiresAt ?? null,
      };
      await port.insertKycDocument(doc);
      return doc;
    },

    async submitKyc(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (vendor.kycStatus === 'approved' || vendor.kycStatus === 'rejected') {
        throw new Error(`Vendor ${args.vendorId} KYC already finalised (${vendor.kycStatus})`);
      }
      const required = kycRequirementsFor(vendor.country).requiredDocuments;
      const docs = await port.listKycDocuments(vendor.id);
      const presentTypes = new Set(docs.map((d) => d.type));
      const missingDocuments = required.filter((req) => !presentTypes.has(req));
      if (missingDocuments.length > 0) {
        return { vendor, missingDocuments };
      }
      const updated: Vendor = {
        ...vendor,
        kycStatus: 'submitted',
        statusReason: null,
      };
      await port.updateVendor(updated);
      return { vendor: updated, missingDocuments: [] };
    },

    async approveKyc(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (vendor.kycStatus !== 'submitted') {
        throw new Error(
          `Cannot approve KYC: vendor is in '${vendor.kycStatus}' status — must be 'submitted'`,
        );
      }
      const updated: Vendor = {
        ...vendor,
        kycStatus: 'approved',
        kycDecidedAt: clock.now().toISOString(),
        statusReason: `approved by ${args.approverId}`,
      };
      await port.updateVendor(updated);
      return updated;
    },

    async rejectKyc(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (args.reason.trim().length === 0) {
        throw new Error('Rejection reason is required');
      }
      const updated: Vendor = {
        ...vendor,
        kycStatus: 'rejected',
        kycDecidedAt: clock.now().toISOString(),
        statusReason: `rejected by ${args.approverId}: ${args.reason}`,
      };
      await port.updateVendor(updated);
      return updated;
    },

    async blacklistVendor(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (args.reason.trim().length === 0) {
        throw new Error('Blacklist reason is required');
      }
      const updated: Vendor = {
        ...vendor,
        preferredStatus: 'blacklisted',
        kycStatus: 'blocked',
        statusReason: `blacklisted: ${args.reason}`,
      };
      await port.updateVendor(updated);
      return updated;
    },

    async setPreferred(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (vendor.kycStatus !== 'approved') {
        throw new Error('Only KYC-approved vendors can be marked preferred');
      }
      const updated: Vendor = {
        ...vendor,
        preferredStatus: 'preferred',
      };
      await port.updateVendor(updated);
      return updated;
    },

    async rateVendor(args) {
      const vendor = await port.findVendor(args.vendorId);
      if (!vendor) {
        throw new Error(`Vendor ${args.vendorId} not found`);
      }
      if (args.rating < 1 || args.rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }
      const newRating =
        vendor.rating === null ? args.rating : (vendor.rating * 0.7 + args.rating * 0.3);
      const updated: Vendor = {
        ...vendor,
        rating: Math.round(newRating * 10) / 10,
      };
      await port.updateVendor(updated);
      return updated;
    },
  };
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
