/**
 * Role dispatcher — picks the right profile builder for the given role.
 */
import type { AnyProfile, Role } from '../types.js';
import { buildTenantProfile } from './tenant-profile.js';
import { buildOwnerProfile } from './owner-profile.js';
import { buildPMProfile } from './pm-profile.js';
import { buildEstateMgrProfile } from './estate-mgr-profile.js';
import { buildAdminProfile } from './admin-profile.js';
import { buildProspectProfile } from './prospect-profile.js';

export interface BuildProfileArgs {
  readonly role: Role;
  readonly userId: string;
  readonly tenantId: string;
  readonly db: unknown;
}

/**
 * Dispatch to the right role-specific builder. Returns the unified
 * `AnyProfile` union so callers can narrow with `'role' in result`
 * semantics if needed — though most consumers route by role first.
 */
export async function buildProfile(args: BuildProfileArgs): Promise<AnyProfile> {
  switch (args.role) {
    case 'tenant':
      return buildTenantProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    case 'owner':
      return buildOwnerProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    case 'pm':
      return buildPMProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    case 'estate_mgr':
      return buildEstateMgrProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    case 'admin':
      return buildAdminProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    case 'prospect':
      return buildProspectProfile({
        userId: args.userId,
        tenantId: args.tenantId,
        db: args.db,
      });
    default: {
      const _exhaustive: never = args.role;
      throw new Error(`buildProfile: unknown role ${String(_exhaustive)}`);
    }
  }
}

export { buildTenantProfile } from './tenant-profile.js';
export { buildOwnerProfile } from './owner-profile.js';
export { buildPMProfile } from './pm-profile.js';
export { buildEstateMgrProfile } from './estate-mgr-profile.js';
export { buildAdminProfile } from './admin-profile.js';
export { buildProspectProfile } from './prospect-profile.js';
