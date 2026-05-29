/**
 * Owner-docs presigned-PUT issuer — Wave OWNER-OS.
 *
 * Replaces the placeholder string-pasted URL in
 * `routes/owner/docs.hono.ts` with a real Supabase Storage signed-upload
 * URL backed by the service-role admin client.
 *
 * Path scheme:
 *   tenant-uploads/<tenantId>/<YYYY-MM>/<documentId>.<ext>
 *
 * The bucket (`tenant-uploads`) is one of the canonical bootstrap
 * buckets declared in `@borjie/supabase-client`'s `EXPECTED_BUCKETS`.
 * If the bucket is missing we attempt to create it as PRIVATE on the
 * fly (idempotent — the call no-ops on AlreadyExists). The path's
 * leading segment is the tenantId, so Storage RLS policies of the
 * shape:
 *
 *   (storage.foldername(name))[1] = current_setting('app.tenant_id', true)
 *
 * are sufficient to prevent cross-tenant reads / writes from any
 * non-service-role caller.
 *
 * The signed URL has a 5-minute TTL — long enough for a slow mobile
 * upload, short enough that a leaked URL cannot be replayed days
 * later.
 *
 * When the Supabase env vars are unset we degrade to the legacy
 * placeholder so local-dev gateways still respond. The degraded path
 * is annotated in the returned payload (`degraded:true`) so the FE
 * can warn the operator.
 */

import { createSupabaseAdminClient } from '@borjie/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-docs-storage-presign');

const BUCKET_NAME = 'tenant-uploads';
const TTL_SECONDS = 5 * 60;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface PresignArgs {
  readonly tenantId: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
}

export interface PresignResult {
  readonly bucket: string;
  readonly path: string;
  /** Absolute URL the FE PUTs the bytes to. */
  readonly uploadUrl: string;
  /** Bearer-style token Supabase requires on the signed PUT. */
  readonly token: string;
  /** Wall-clock ISO of when the signature expires. */
  readonly expiresAt: string;
  /** Headers the FE must send on the PUT (Content-Type at minimum). */
  readonly headers: Record<string, string>;
  /** True when the gateway is running without Supabase env wired. */
  readonly degraded: boolean;
}

let cachedClient: SupabaseClient | null = null;
let cachedBucketChecked = false;

function getAdminClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    // `createSupabaseAdminClient` returns a `SupabaseClient` via the
    // package's CJS resolution path; the local type-only import here
    // uses ESM resolution with `exactOptionalPropertyTypes`. The two
    // shapes are structurally identical — narrow through `unknown` to
    // bridge the dual-resolution skew without losing call-site safety.
    cachedClient = createSupabaseAdminClient({
      url,
      serviceRoleKey: key,
    }) as unknown as SupabaseClient;
    return cachedClient;
  } catch (err) {
    moduleLogger.warn('supabase admin client init failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function ensureBucketExists(supabase: SupabaseClient): Promise<void> {
  if (cachedBucketChecked) return;
  try {
    const { data, error } = await supabase.storage.getBucket(BUCKET_NAME);
    if (!error && data) {
      cachedBucketChecked = true;
      return;
    }
    // Bucket missing — create as PRIVATE. The first-call race is
    // tolerated: Supabase returns AlreadyExists when two boots collide.
    const createRes = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: MAX_FILE_BYTES,
    });
    if (
      createRes.error &&
      !createRes.error.message.toLowerCase().includes('already')
    ) {
      moduleLogger.warn('createBucket failed', {
        bucket: BUCKET_NAME,
        reason: createRes.error.message,
      });
      return;
    }
    cachedBucketChecked = true;
  } catch (err) {
    moduleLogger.warn('ensureBucketExists threw', {
      bucket: BUCKET_NAME,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function extensionFor(fileName: string, mimeType: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx < fileName.length - 1) {
    return fileName.slice(dotIdx + 1).toLowerCase();
  }
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'text/plain':
      return 'txt';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    default:
      return 'bin';
  }
}

function monthBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Build the per-tenant object path. Leading tenant-id is what RLS
 * policies on storage.objects key off.
 */
export function buildOwnerDocPath(args: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
}): string {
  const ext = extensionFor(args.fileName, args.mimeType);
  return `${args.tenantId}/${monthBucket()}/${args.documentId}.${ext}`;
}

function legacyDegraded(args: PresignArgs): PresignResult {
  const path = buildOwnerDocPath(args);
  return {
    bucket: BUCKET_NAME,
    path,
    uploadUrl: `${BUCKET_NAME}/${path}`,
    token: '',
    expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    headers: { 'Content-Type': args.mimeType },
    degraded: true,
  };
}

/**
 * Issue a real Supabase Storage signed-upload URL. Returns
 * `degraded:true` when the env is unwired so the caller can degrade
 * gracefully (no throw — keeps the gateway boot-safe).
 */
export async function issueOwnerDocPresign(
  args: PresignArgs,
): Promise<PresignResult> {
  if (args.fileSize > MAX_FILE_BYTES) {
    throw new Error(`file too large: ${args.fileSize} > ${MAX_FILE_BYTES}`);
  }
  const supabase = getAdminClient();
  if (!supabase) {
    moduleLogger.warn('owner-docs-presign degraded — supabase env not wired', {
      tenantId: args.tenantId,
    });
    return legacyDegraded(args);
  }
  await ensureBucketExists(supabase);
  const path = buildOwnerDocPath(args);
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path);
    if (error || !data) {
      moduleLogger.warn('createSignedUploadUrl failed', {
        tenantId: args.tenantId,
        path,
        reason: error?.message ?? 'no data',
      });
      return legacyDegraded(args);
    }
    return {
      bucket: BUCKET_NAME,
      path: data.path ?? path,
      uploadUrl: data.signedUrl,
      token: data.token,
      expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
      headers: { 'Content-Type': args.mimeType },
      degraded: false,
    };
  } catch (err) {
    moduleLogger.warn('createSignedUploadUrl threw', {
      tenantId: args.tenantId,
      path,
      reason: err instanceof Error ? err.message : String(err),
    });
    return legacyDegraded(args);
  }
}
