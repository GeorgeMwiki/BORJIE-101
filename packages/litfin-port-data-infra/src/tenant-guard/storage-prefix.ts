/**
 * Object-storage key prefix helpers (S3-style).
 *
 * Same shape as the Redis wrapper: every key is `<tenantId>/<rest>`,
 * the first path segment is reserved for the tenant id.
 *
 * `assertTenantPrefixedPath` is meant for use inside the wrapped
 * client and inside the leak scanner. Application code should build
 * paths via `tenantPath()`.
 *
 * Ported verbatim from @litfin/tenant-guard.
 */

import { getTenantContext } from "./context";
import { IsolationViolation, type TenantId } from "./types";

export function tenantPath(tenantId: TenantId, rel: string): string {
  if (!rel) {
    throw new IsolationViolation({
      layer: "storage",
      kind: "missing-tenant-prefix",
      expectedTenantId: tenantId,
      hint: "tenantPath rel must not be empty",
    });
  }
  const trimmed = rel.startsWith("/") ? rel.slice(1) : rel;
  return `${tenantId}/${trimmed}`;
}

export function assertTenantPrefixedPath(
  path: string,
  tenantId: TenantId,
): void {
  const expected = `${tenantId}/`;
  if (!path.startsWith(expected)) {
    throw new IsolationViolation({
      layer: "storage",
      kind: "missing-tenant-prefix",
      observedTenantId: path.split("/")[0] ?? path,
      expectedTenantId: tenantId,
      hint: `storage path "${path.slice(0, 80)}..." missing expected tenant prefix`,
    });
  }
}

/**
 * Minimal S3-style surface. The wrapped client must already
 * encapsulate the bucket; we manipulate the Key only.
 */
export interface S3LikeClient {
  putObject(args: {
    Key: string;
    Body: unknown;
    [k: string]: unknown;
  }): Promise<unknown>;
  getObject(args: { Key: string; [k: string]: unknown }): Promise<unknown>;
  deleteObject(args: { Key: string; [k: string]: unknown }): Promise<unknown>;
  listObjects?(args: {
    Prefix?: string;
    [k: string]: unknown;
  }): Promise<unknown>;
}

function resolveKey(key: string): string {
  const ctx = getTenantContext();
  if (key.startsWith(`${ctx.tenantId}/`)) {
    assertTenantPrefixedPath(key, ctx.tenantId);
    return key;
  }
  return tenantPath(ctx.tenantId, key);
}

export function wrapStorageWithTenantPrefix<T extends S3LikeClient>(
  client: T,
): T {
  const orig = {
    putObject: client.putObject.bind(client),
    getObject: client.getObject.bind(client),
    deleteObject: client.deleteObject.bind(client),
    listObjects: client.listObjects?.bind(client),
  };
  const wrap: S3LikeClient = {
    putObject: async (args) =>
      orig.putObject({ ...args, Key: resolveKey(args.Key) }),
    getObject: async (args) =>
      orig.getObject({ ...args, Key: resolveKey(args.Key) }),
    deleteObject: async (args) =>
      orig.deleteObject({ ...args, Key: resolveKey(args.Key) }),
    listObjects: orig.listObjects
      ? async (args) =>
          orig.listObjects!({
            ...args,
            Prefix: args.Prefix
              ? resolveKey(args.Prefix)
              : `${getTenantContext().tenantId}/`,
          })
      : undefined,
  };
  return Object.assign(client, wrap) as T;
}
