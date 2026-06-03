/**
 * OnboardingStore — pluggable persistence layer for the tenant-signup flow.
 *
 * Two implementations:
 *   - `createInMemoryOnboardingStore()` — exact extraction of the Map logic
 *     from onboarding.router.ts. Used in dev/test when DATABASE_URL is absent.
 *   - `createDrizzleOnboardingStore(db)` — real Drizzle persistence against
 *     the three tables added in migration 0188:
 *       owner_onboarding_credentials
 *       onboarding_signup_sessions
 *       onboarding_email_verifications
 *
 * The router selects the right implementation at the top of every handler:
 *
 *   const db = c.get('db');
 *   const store = db
 *     ? createDrizzleOnboardingStore(db)
 *     : sharedInMemoryStore;
 *
 * Design invariants
 *   - Immutability: every method returns new values; nothing mutates in place.
 *   - No console.*: errors surface as thrown exceptions (caller catches + logs).
 *   - Email dedup: createCredential throws `DuplicateEmailError` on conflict
 *     (DB unique-violation or in-memory Map hit); the route maps this to 409.
 *   - Token one-shot: consumeVerification marks the row consumed; a second call
 *     returns null even if the row still exists.
 */

import { eq, sql } from 'drizzle-orm';
import {
  ownerOnboardingCredentials,
  onboardingSignupSessions,
  onboardingEmailVerifications,
} from '@borjie/database';

// ---------------------------------------------------------------------------
// Shared domain types (mirroring the router's in-file types)
// ---------------------------------------------------------------------------

export type OnboardingFlowStepId =
  | 'account_created'
  | 'verify_email'
  | 'first_site'
  | 'first_workforce_import'
  | 'first_md_chat'
  | 'owner_intent'
  | 'install_starter_skills'
  | 'schedule_daily_briefing';

export interface OnboardingFlowStep {
  readonly id: OnboardingFlowStepId;
  readonly label: string;
  readonly description: string;
  readonly completed: boolean;
  readonly completedAt?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface OwnerCredential {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
}

export interface OnboardingSession {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly email: string;
  readonly businessName: string;
  readonly country: string;
  readonly sessionToken: string;
  readonly createdAt: string;
  readonly steps: ReadonlyArray<OnboardingFlowStep>;
  readonly intent?: 'cashflow' | 'growth' | 'exit';
  readonly firstSiteId?: string;
  readonly firstChatThreadId?: string;
  readonly suggestedSkills?: ReadonlyArray<string>;
}

export interface PendingVerification {
  readonly tenantId: string;
  readonly email: string;
  readonly issuedAtMs: number;
}

// ---------------------------------------------------------------------------
// Sentinel error: thrown by createCredential on email conflict.
// The route catches this and returns 409.
// ---------------------------------------------------------------------------

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`email-already-registered: ${email}`);
    this.name = 'DuplicateEmailError';
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface OnboardingStore {
  // ── credentials ──────────────────────────────────────────────────────────
  /**
   * Insert a new credential row.
   * @throws {DuplicateEmailError} if the email already exists.
   */
  createCredential(cred: OwnerCredential): Promise<void>;
  getCredentialByTenant(tenantId: string): Promise<OwnerCredential | null>;
  markCredentialEmailVerified(
    tenantId: string,
    verifiedAt: string,
  ): Promise<void>;

  // ── sessions ─────────────────────────────────────────────────────────────
  createSession(session: OnboardingSession): Promise<void>;
  getSessionByTenant(tenantId: string): Promise<OnboardingSession | null>;
  getSessionByToken(token: string): Promise<OnboardingSession | null>;
  updateSession(
    tenantId: string,
    patch: Partial<Omit<OnboardingSession, 'tenantId' | 'createdAt'>>,
  ): Promise<OnboardingSession | null>;

  // ── email verifications ───────────────────────────────────────────────────
  createVerification(token: string, pending: PendingVerification): Promise<void>;
  /** Returns the pending record if it exists AND has not been consumed. */
  getVerification(token: string): Promise<PendingVerification | null>;
  /** Mark the token consumed. Returns null if already consumed or missing. */
  consumeVerification(token: string): Promise<PendingVerification | null>;

  // ── test-only ─────────────────────────────────────────────────────────────
  /** Wipe all in-memory state. No-op for the Drizzle implementation. */
  reset(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation (verbatim Map logic from onboarding.router.ts)
// ---------------------------------------------------------------------------

interface InMemoryCredentialStore {
  emailToTenantId: Map<string, string>;
  tenantIdToCredential: Map<string, OwnerCredential>;
}

export function createInMemoryOnboardingStore(): OnboardingStore {
  const credStore: InMemoryCredentialStore = {
    emailToTenantId: new Map(),
    tenantIdToCredential: new Map(),
  };
  const sessions = new Map<string, OnboardingSession>();
  const sessionsByToken = new Map<string, string>();
  const pendingVerifications = new Map<
    string,
    { tenantId: string; email: string; issuedAtMs: number }
  >();

  return {
    async createCredential(cred) {
      if (credStore.emailToTenantId.has(cred.email)) {
        throw new DuplicateEmailError(cred.email);
      }
      credStore.emailToTenantId.set(cred.email, cred.tenantId);
      credStore.tenantIdToCredential.set(cred.tenantId, cred);
    },

    async getCredentialByTenant(tenantId) {
      return credStore.tenantIdToCredential.get(tenantId) ?? null;
    },

    async markCredentialEmailVerified(tenantId, verifiedAt) {
      const existing = credStore.tenantIdToCredential.get(tenantId);
      if (!existing) return;
      credStore.tenantIdToCredential.set(tenantId, {
        ...existing,
        emailVerifiedAt: verifiedAt,
      });
    },

    async createSession(session) {
      sessions.set(session.tenantId, session);
    },

    async getSessionByTenant(tenantId) {
      return sessions.get(tenantId) ?? null;
    },

    async getSessionByToken(token) {
      const tenantId = sessionsByToken.get(token);
      if (!tenantId) return null;
      return sessions.get(tenantId) ?? null;
    },

    async updateSession(tenantId, patch) {
      const existing = sessions.get(tenantId);
      if (!existing) return null;
      const updated: OnboardingSession = {
        ...existing,
        ...patch,
        tenantId,
        createdAt: existing.createdAt,
      };
      sessions.set(tenantId, updated);
      // Maintain the token index if the sessionToken changed.
      if (patch.sessionToken !== undefined && patch.sessionToken !== '') {
        sessionsByToken.set(patch.sessionToken, tenantId);
      }
      return updated;
    },

    async createVerification(token, pending) {
      pendingVerifications.set(token, pending);
    },

    async getVerification(token) {
      return pendingVerifications.get(token) ?? null;
    },

    async consumeVerification(token) {
      const pending = pendingVerifications.get(token);
      if (!pending) return null;
      pendingVerifications.delete(token);
      return pending;
    },

    async reset() {
      sessions.clear();
      sessionsByToken.clear();
      pendingVerifications.clear();
      credStore.emailToTenantId.clear();
      credStore.tenantIdToCredential.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Drizzle implementation
// ---------------------------------------------------------------------------

// Drizzle db type — minimal surface the store needs. The full db handle
// injected by databaseMiddleware satisfies this shape.
type DrizzleDb = {
  insert(table: unknown): {
    values(data: unknown): Promise<unknown>;
  };
  select(): {
    from(table: unknown): {
      where(cond: unknown): Promise<unknown[]>;
    };
  };
  update(table: unknown): {
    set(data: unknown): {
      where(cond: unknown): Promise<unknown>;
    };
  };
  execute(q: unknown): Promise<unknown>;
};

// Postgres unique-violation error code.
const PG_UNIQUE_VIOLATION = '23505';

function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>)['code'];
  return code === PG_UNIQUE_VIOLATION;
}

function rowToCredential(row: Record<string, unknown>): OwnerCredential {
  return {
    tenantId: String(row['tenant_id']),
    ownerUserId: String(row['owner_user_id']),
    email: String(row['email']),
    passwordHash: String(row['password_hash']),
    emailVerifiedAt:
      row['email_verified_at'] != null
        ? new Date(row['email_verified_at'] as string | Date).toISOString()
        : null,
    createdAt: new Date(row['created_at'] as string | Date).toISOString(),
  };
}

function rowToSession(row: Record<string, unknown>): OnboardingSession {
  const steps = (row['steps'] ?? []) as ReadonlyArray<OnboardingFlowStep>;
  const base: OnboardingSession = {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    ownerUserId: String(row['owner_user_id']),
    email: String(row['email']),
    businessName: String(row['business_name']),
    country: String(row['country']),
    sessionToken: row['session_token'] != null ? String(row['session_token']) : '',
    createdAt: new Date(row['created_at'] as string | Date).toISOString(),
    steps,
  };
  const intent = row['intent'];
  const firstSiteId = row['first_site_id'];
  const firstChatThreadId = row['first_chat_thread_id'];
  const suggestedSkills = row['suggested_skills'];
  return {
    ...base,
    ...(intent != null ? { intent: intent as 'cashflow' | 'growth' | 'exit' } : {}),
    ...(firstSiteId != null ? { firstSiteId: String(firstSiteId) } : {}),
    ...(firstChatThreadId != null
      ? { firstChatThreadId: String(firstChatThreadId) }
      : {}),
    ...(suggestedSkills != null
      ? { suggestedSkills: suggestedSkills as ReadonlyArray<string> }
      : {}),
  };
}

function rowToVerification(row: Record<string, unknown>): PendingVerification {
  return {
    tenantId: String(row['tenant_id']),
    email: String(row['email']),
    issuedAtMs: new Date(row['issued_at'] as string | Date).getTime(),
  };
}

export function createDrizzleOnboardingStore(db: unknown): OnboardingStore {
  const typedDb = db as DrizzleDb;

  return {
    async createCredential(cred) {
      try {
        await typedDb
          .insert(ownerOnboardingCredentials)
          .values({
            tenantId: cred.tenantId,
            ownerUserId: cred.ownerUserId,
            email: cred.email,
            passwordHash: cred.passwordHash,
            emailVerifiedAt:
              cred.emailVerifiedAt != null
                ? new Date(cred.emailVerifiedAt)
                : null,
            createdAt: new Date(cred.createdAt),
          });
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          throw new DuplicateEmailError(cred.email);
        }
        throw err;
      }
    },

    async getCredentialByTenant(tenantId) {
      const rows = (await typedDb
        .select()
        .from(ownerOnboardingCredentials)
        .where(eq(ownerOnboardingCredentials.tenantId, tenantId))) as Record<
        string,
        unknown
      >[];
      if (rows.length === 0) return null;
      return rowToCredential(rows[0]!);
    },

    async markCredentialEmailVerified(tenantId, verifiedAt) {
      await typedDb
        .update(ownerOnboardingCredentials)
        .set({ emailVerifiedAt: new Date(verifiedAt) })
        .where(eq(ownerOnboardingCredentials.tenantId, tenantId));
    },

    async createSession(session) {
      await typedDb
        .insert(onboardingSignupSessions)
        .values({
          tenantId: session.tenantId,
          id: session.id,
          ownerUserId: session.ownerUserId,
          email: session.email,
          businessName: session.businessName,
          country: session.country,
          sessionToken: session.sessionToken || null,
          steps: session.steps as unknown,
          intent: session.intent ?? null,
          firstSiteId: session.firstSiteId ?? null,
          firstChatThreadId: session.firstChatThreadId ?? null,
          suggestedSkills: session.suggestedSkills ?? null,
          createdAt: new Date(session.createdAt),
        });
    },

    async getSessionByTenant(tenantId) {
      const rows = (await typedDb
        .select()
        .from(onboardingSignupSessions)
        .where(
          eq(onboardingSignupSessions.tenantId, tenantId),
        )) as Record<string, unknown>[];
      if (rows.length === 0) return null;
      return rowToSession(rows[0]!);
    },

    async getSessionByToken(token) {
      // Use a raw SQL fragment so Drizzle doesn't complain about the partial
      // index; result is still a typed row array.
      const rows = (await typedDb.execute(
        sql`SELECT * FROM onboarding_signup_sessions WHERE session_token = ${token} LIMIT 1`,
      )) as unknown;
      const arr = Array.isArray(rows)
        ? (rows as Record<string, unknown>[])
        : ((rows as { rows?: Record<string, unknown>[] }).rows ?? []);
      if (arr.length === 0) return null;
      return rowToSession(arr[0]!);
    },

    async updateSession(tenantId, patch) {
      const existing = await this.getSessionByTenant(tenantId);
      if (!existing) return null;
      const updated: OnboardingSession = {
        ...existing,
        ...patch,
        tenantId,
        createdAt: existing.createdAt,
      };
      await typedDb
        .update(onboardingSignupSessions)
        .set({
          sessionToken:
            updated.sessionToken !== '' ? updated.sessionToken : null,
          steps: updated.steps as unknown,
          intent: updated.intent ?? null,
          firstSiteId: updated.firstSiteId ?? null,
          firstChatThreadId: updated.firstChatThreadId ?? null,
          suggestedSkills: updated.suggestedSkills ?? null,
        })
        .where(eq(onboardingSignupSessions.tenantId, tenantId));
      return updated;
    },

    async createVerification(token, pending) {
      await typedDb
        .insert(onboardingEmailVerifications)
        .values({
          token,
          tenantId: pending.tenantId,
          email: pending.email,
          issuedAt: new Date(pending.issuedAtMs),
          consumedAt: null,
        });
    },

    async getVerification(token) {
      const rows = (await typedDb
        .select()
        .from(onboardingEmailVerifications)
        .where(
          eq(onboardingEmailVerifications.token, token),
        )) as Record<string, unknown>[];
      if (rows.length === 0) return null;
      const row = rows[0]!;
      // Return null if already consumed.
      if (row['consumed_at'] != null) return null;
      return rowToVerification(row);
    },

    async consumeVerification(token) {
      const rows = (await typedDb
        .select()
        .from(onboardingEmailVerifications)
        .where(
          eq(onboardingEmailVerifications.token, token),
        )) as Record<string, unknown>[];
      if (rows.length === 0) return null;
      const row = rows[0]!;
      // Already consumed — return null without updating.
      if (row['consumed_at'] != null) return null;
      const pending = rowToVerification(row);
      await typedDb
        .update(onboardingEmailVerifications)
        .set({ consumedAt: new Date() })
        .where(eq(onboardingEmailVerifications.token, token));
      return pending;
    },

    async reset() {
      // No-op for the production Drizzle path. Tests use the in-memory store.
    },
  };
}
