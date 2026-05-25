/**
 * Anti-Corruption Layer (DDD) — types.
 *
 * The ACL pattern says: when your bounded context talks to a foreign
 * model (a vendor's API shape, a legacy DB schema, a partner system),
 * translate at the boundary. Never let the foreign shape leak into
 * your domain.
 *
 * In our codebase the two big foreign shapes are:
 *   1. Drizzle row shapes (snake_case, nullable everything, primitive
 *      types). Domain wants camelCase, branded ids, value objects.
 *   2. M-Pesa STK push / callback responses. Vendor shape is loose,
 *      string-typed, and uses Swahili shorthand keys. Domain wants
 *      typed events.
 *
 * The base class plus two worked examples give the team a concrete
 * pattern to copy for every new boundary.
 */

/**
 * Bidirectional translator between a domain type and an external
 * representation. The domain type is the source of truth; `fromDomain`
 * is the round-trip side used when persisting / outbounding.
 */
export interface ACL<TDomain, TExternal> {
  toDomain(external: TExternal): TDomain;
  fromDomain(domain: TDomain): TExternal;
}

/** Optional readonly-projection ACL — many callers only need toDomain. */
export interface ReadACL<TDomain, TExternal> {
  toDomain(external: TExternal): TDomain;
}
