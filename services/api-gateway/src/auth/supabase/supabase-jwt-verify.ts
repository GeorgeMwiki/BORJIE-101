/**
 * Standalone Supabase JWT verification.
 *
 * Mirrors `packages/ai-copilot/src/config/supabase-auth.ts` but is
 * inlined here so the api-gateway has a single source of truth for
 * the auth path without a cross-package dependency on ai-copilot's
 * private exports. Keep the two in sync — if behaviour diverges,
 * promote this file to a shared package.
 */

import { jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';

export interface SupabaseAuthPrincipal {
  readonly userId: string;
  readonly email?: string | undefined;
  readonly tenantId: string;
  readonly tenantName?: string | undefined;
  readonly environment: 'production' | 'staging' | 'development';
  readonly roles: string[];
  readonly teamIds: string[];
  readonly employeeId?: string | undefined;
  readonly raw: JWTPayload;
}

export class SupabaseAuthError extends Error {
  readonly kind = 'SupabaseAuthError' as const;
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = 'SupabaseAuthError';
    this.status = status;
  }
}

const MetadataSchema = z
  .object({
    tenant_id: z.string().optional(),
    tenant_name: z.string().optional(),
    roles: z.array(z.string()).optional(),
    team_ids: z.array(z.string()).optional(),
    employee_id: z.string().optional(),
    environment: z
      .enum(['production', 'staging', 'development'])
      .optional(),
  })
  .partial();

export interface VerifySupabaseJwtOptions {
  readonly jwtSecret: string;
  readonly defaultEnvironment?: 'production' | 'staging' | 'development';
}

export async function verifySupabaseJwt(
  token: string,
  opts: VerifySupabaseJwtOptions,
): Promise<SupabaseAuthPrincipal> {
  if (!token || typeof token !== 'string') {
    throw new SupabaseAuthError('missing_token', 401);
  }
  const secret = new TextEncoder().encode(opts.jwtSecret);
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
    payload = verified.payload;
  } catch (err) {
    throw new SupabaseAuthError(
      `invalid_token: ${err instanceof Error ? err.message : String(err)}`,
      401,
    );
  }

  const userId = String(payload.sub ?? '');
  if (!userId) throw new SupabaseAuthError('missing_subject', 401);

  const appMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).app_metadata ?? {},
  );
  const userMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).user_metadata ?? {},
  );
  const app = appMd.success ? appMd.data : {};
  const user = userMd.success ? userMd.data : {};
  const md = { ...user, ...app };

  const tenantId = md.tenant_id;
  if (!tenantId) {
    throw new SupabaseAuthError(
      'missing_tenant: user has no tenant_id in app_metadata or user_metadata',
      403,
    );
  }

  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    tenantId,
    tenantName: md.tenant_name,
    environment: md.environment ?? opts.defaultEnvironment ?? 'production',
    roles: md.roles ?? [],
    teamIds: md.team_ids ?? [],
    employeeId: md.employee_id,
    raw: payload,
  };
}

export function extractBearer(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}
