/**
 * `@borjie/anti-corruption-layer` — public surface.
 *
 * LITFIN-parity item 3. The pattern, the base class, the codegen,
 * and two worked examples (Drizzle + M-Pesa). New domain boundaries
 * should follow the same shape:
 *
 *   1. Define the domain type (camelCase, branded ids, no nulls).
 *   2. Define the external type (mirror the vendor / DB shape exactly).
 *   3. Subclass `BaseACL<Domain, External>`.
 *   4. Implement `mapToDomain` + `mapFromDomain`.
 *   5. Use the ACL at the boundary; never let external shapes leak.
 *
 * See `README.md` for the long-form explanation and an exhaustive
 * decision tree on when to ACL vs when to just use Zod.
 */

export type { ACL, ReadACL } from "./types.js";
export { BaseACL, type BaseACLOptions } from "./base-acl.js";

// Worked examples — re-exported so consumers can subclass / read.
export {
  TenantDrizzleACL,
  type TenantId,
  type DrizzleTenantRow,
  type DomainTenant,
} from "./drizzle-acl.js";
export {
  MPesaSTKPushACL,
  type MpesaStkPushResponse,
  type PaymentInitiatedDomainEvent,
} from "./mpesa-acl.js";

// Codegen.
export {
  generateACL,
  type GenerateACLOptions,
  type FieldMapping,
} from "./generator.js";
