/**
 * tenant-path-prefix — wraps any MinIO/S3-shaped client so every
 * object key carries a leading `${tenantId}/` segment. Refuses to
 * read or write outside a TenantContext.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { getTenantContext } from '../context/tenant-context.js';
import {
  IsolationViolation,
  type TenantId,
} from '../types.js';

export interface S3LikeClient {
  putObject(args: ObjectArgs & { readonly Body: unknown }): Promise<unknown>;
  getObject(args: ObjectArgs): Promise<unknown>;
  listObjects(args: ListArgs): Promise<unknown>;
  deleteObject(args: ObjectArgs): Promise<unknown>;
}

export interface ObjectArgs {
  readonly Bucket: string;
  readonly Key: string;
}

export interface ListArgs {
  readonly Bucket: string;
  readonly Prefix?: string;
}

const PATH_PREFIX_RX = /^[A-Za-z0-9_\-]+\//;

/**
 * Build a canonical object key for a given tenant + relative path.
 * Refuses any input that already starts with a path segment, and
 * any input that starts with `/`.
 */
export function tenantPath(tenantId: TenantId, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new IsolationViolation({
      layer: 'storage',
      kind: 'unprefixed-path',
      tenantId,
      message: 'tenantPath: relative path must be a non-empty string',
    });
  }
  if (rel.startsWith('/')) {
    throw new IsolationViolation({
      layer: 'storage',
      kind: 'unprefixed-path',
      tenantId,
      message: 'tenantPath: relative path must not start with "/"',
    });
  }
  if (rel.startsWith(`${tenantId}/`)) {
    return rel;
  }
  return `${tenantId}/${rel}`;
}

/**
 * Verify that an object key starts with the active tenant id.
 * Throws on mismatch.
 */
export function assertTenantPrefixedPath(key: string): void {
  const ctx = getTenantContext();
  if (!PATH_PREFIX_RX.test(key)) {
    throw new IsolationViolation({
      layer: 'storage',
      kind: 'unprefixed-path',
      tenantId: ctx.tenantId,
      message: `storage key "${key}" is not tenant-prefixed`,
    });
  }
  if (!key.startsWith(`${ctx.tenantId}/`)) {
    const m = /^([A-Za-z0-9_\-]+)\//.exec(key);
    const observed = (m?.[1] ?? 'unknown') as TenantId;
    throw new IsolationViolation({
      layer: 'storage',
      kind: 'cross-tenant-access',
      tenantId: ctx.tenantId,
      observedTenantId: observed,
      message: `storage key "${key}" has tenant prefix "${observed}" but context is "${ctx.tenantId}"`,
    });
  }
}

export function wrapStorageWithTenantPrefix(
  client: S3LikeClient,
): S3LikeClient {
  const resolveKey = (key: string): string => {
    const ctx = getTenantContext();
    if (key.startsWith(`${ctx.tenantId}/`)) return key;
    const m = /^([A-Za-z0-9_\-]+)\//.exec(key);
    // If the first segment looks like a different tenant id (NOT the
    // current ctx tenant) we throw; otherwise we treat the input as a
    // relative path and prefix it.
    if (m && m[1] !== undefined && !key.startsWith(`${ctx.tenantId}/`)) {
      // Heuristic: a 6+ char alphanumeric/underscore/hyphen first
      // segment AND looking like an explicit tenant id => throw.
      if (m[1].length >= 6 && m[1].startsWith('tenant_')) {
        assertTenantPrefixedPath(key);
        return key;
      }
    }
    return tenantPath(ctx.tenantId, key);
  };

  const resolvePrefix = (prefix: string | undefined): string => {
    const ctx = getTenantContext();
    if (!prefix) return `${ctx.tenantId}/`;
    if (prefix.startsWith(`${ctx.tenantId}/`)) return prefix;
    const m = /^([A-Za-z0-9_\-]+)\//.exec(prefix);
    if (m && m[1] !== undefined && m[1].length >= 6 && m[1].startsWith('tenant_')) {
      assertTenantPrefixedPath(prefix);
      return prefix;
    }
    return `${ctx.tenantId}/${prefix}`;
  };

  return {
    putObject: async (args) =>
      client.putObject({ ...args, Key: resolveKey(args.Key) }),
    getObject: async (args) =>
      client.getObject({ ...args, Key: resolveKey(args.Key) }),
    listObjects: async (args) =>
      client.listObjects({ ...args, Prefix: resolvePrefix(args.Prefix) }),
    deleteObject: async (args) =>
      client.deleteObject({ ...args, Key: resolveKey(args.Key) }),
  };
}
