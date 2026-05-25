/**
 * Feature-flag domain types.
 *
 * LITFIN-parity item 1. The port abstracts over GrowthBook, Unleash, our
 * own DB-backed table, and an in-memory fixture for tests. Live test
 * needs staged rollout per tenant — a single hard-coded "on/off" toggle
 * is not enough.
 */

/**
 * Evaluation context — passed to every flag check. The adapter combines
 * this with the flag's rules (tenant allow-list, % rollout bucket,
 * attribute predicate) to decide on/off.
 *
 * `tenantId` is the single most important attribute — staged rollout
 * lives at the tenant grain. `userId` is used for sticky per-user
 * bucketing inside a tenant (so a user always sees the same variant).
 */
export interface FlagContext {
  /** Tenant scope. REQUIRED for tenant-scoped flags. */
  readonly tenantId: string;
  /** User scope. Optional — used for per-user sticky bucketing. */
  readonly userId?: string;
  /** Free-form attributes for rule evaluation (country, plan, etc). */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * A flag as the port sees it. Adapter-specific extras live in
 * `metadata` so the port stays narrow.
 */
export interface Flag {
  readonly key: string;
  readonly enabled: boolean;
  readonly variant?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The port. Implementations: GrowthBook, Unleash, DB, in-memory.
 *
 * All methods are async — even in-memory — so swapping adapters does
 * not force call-site changes. Boolean returns must be definitive;
 * adapters that cannot reach their backend MUST fall back to the
 * port's configured default (see {@link FeatureFlagsConfig}).
 */
export interface FeatureFlagsPort {
  isEnabled(flag: string, context: FlagContext): Promise<boolean>;
  getVariant(flag: string, context: FlagContext): Promise<string>;
  getAllFlags(tenantId: string): Promise<readonly Flag[]>;
}

/** Composition config for {@link createFeatureFlags}. */
export interface FeatureFlagsConfig {
  readonly adapter: FeatureFlagsPort;
  /** Returned by `isEnabled` if the adapter throws. Default: false. */
  readonly defaultEnabled?: boolean;
  /** Returned by `getVariant` if the adapter throws. Default: "control". */
  readonly defaultVariant?: string;
}
