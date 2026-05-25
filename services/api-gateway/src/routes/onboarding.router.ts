// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches; tracked with other routers already on nocheck.

/**
 * Phase F.5 — Tenant-signup onboarding flow router.
 *
 * The owner-facing signup-to-first-action surface. Distinct from
 * `onboarding.ts` (which is the customer/resident move-in flow) — this
 * router covers the SaaS-tenant journey:
 *
 *   1. POST /signup                — email + password + country + business
 *                                    name → returns sessionToken + tenantId
 *                                    + ownerUserId
 *   2. POST /first-property        — adds the first property (address,
 *                                    unit count, rent estimate)
 *   3. POST /first-tenant-import   — bulk import OR manual one-tenant
 *                                    entry
 *   4. POST /first-md-chat         — kicks off the first MD conversation
 *                                    with a curated welcome prompt; spawns
 *                                    the inline welcome.coordinator
 *                                    sub-MD which surveys intent and
 *                                    suggests 3 Skills
 *   5. GET  /checklist             — returns the 8-step onboarding
 *                                    checklist + per-step completion state
 *
 * Storage is in-memory pilot-grade. The shape matches the final HTTP
 * contract so mobile/web can dev against it; swapping to Drizzle is a
 * follow-up (tracked at KI-013, see Docs/KNOWN_ISSUES.md).
 *
 * HIGH-1 (audit .audit/post-pr90-api-mcp-bug-sweep.md): For single-pod
 * deploys this is correct. For multi-pod deploys email-verification
 * links routed to a different pod cannot resolve. The audit-recommended
 * fix is a `onboarding_sessions` + `onboarding_verifications` drizzle
 * migration; until that lands, callers must scale to exactly one
 * onboarding pod OR enable sticky sessions on the load-balancer for
 * `/onboarding/*` paths. The one immediate hardening shipped here is
 * to NOT burn the verification token before the credential lookup
 * succeeds — that bug compounded the multi-pod failure by stranding
 * the user with no retry option.
 *
 * Mounted in index.ts BEFORE the existing /onboarding (customer move-in)
 * router so the specific paths above match first. Anything that doesn't
 * match falls through to the legacy onboarding router untouched.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomUUID, randomBytes } from 'crypto';
import { runWelcomeCoordinator } from '../composition/onboarding-welcome-md';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Crypto-grade ID generation (replaces former Math.random() usage).
//
// CRITICAL #2: session tokens MUST be unguessable; `Math.random()` is
// trivially predictable and leaks credentials via signup-replay. Use
// crypto.randomBytes for tokens, crypto.randomUUID for other IDs.
// ---------------------------------------------------------------------------

/** Cryptographically-strong session token (32 bytes → 43 base64url chars). */
function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Bcrypt cost factor — kept at 10 for parity with auth.ts. */
const BCRYPT_COST = 10;

interface OwnerCredentialStore {
  emailToTenantId: Map<string, string>; // normalized email → tenantId
  tenantIdToCredential: Map<
    string,
    {
      ownerUserId: string;
      email: string;
      passwordHash: string;
      emailVerifiedAt: string | null;
      createdAt: string;
    }
  >;
}

const credentials: OwnerCredentialStore = {
  emailToTenantId: new Map(),
  tenantIdToCredential: new Map(),
};

// ---------------------------------------------------------------------------
// Types + in-memory store
// ---------------------------------------------------------------------------

type OnboardingFlowStepId =
  | 'account_created'
  | 'verify_email'
  | 'first_property'
  | 'first_tenant_import'
  | 'first_md_chat'
  | 'owner_intent'
  | 'install_starter_skills'
  | 'schedule_daily_briefing';

interface OnboardingFlowStep {
  readonly id: OnboardingFlowStepId;
  readonly label: string;
  readonly description: string;
  readonly completed: boolean;
  readonly completedAt?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface OnboardingFlowSession {
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
  readonly firstPropertyId?: string;
  readonly firstChatThreadId?: string;
  readonly suggestedSkills?: ReadonlyArray<string>;
}

const sessions = new Map<string, OnboardingFlowSession>(); // keyed by tenantId
const sessionsByToken = new Map<string, string>(); // sessionToken → tenantId

// Pending email-verification tokens. Burned on first use. In production
// composition this lands in a Drizzle row with a short TTL + audit trail.
const pendingEmailVerifications = new Map<
  string,
  { tenantId: string; email: string; issuedAtMs: number }
>();

const DEFAULT_STEPS: ReadonlyArray<OnboardingFlowStep> = Object.freeze([
  {
    id: 'account_created',
    label: 'Account created',
    description: 'Your tenant + owner account are live.',
    completed: true,
  },
  {
    id: 'verify_email',
    label: 'Verify your email',
    description: 'Click the link we sent to confirm the address.',
    completed: false,
  },
  {
    id: 'first_property',
    label: 'Add your first property',
    description: 'Tell us the address, unit count, and rent estimate.',
    completed: false,
  },
  {
    id: 'first_tenant_import',
    label: 'Import your tenants',
    description: 'CSV upload or add one tenant manually.',
    completed: false,
  },
  {
    id: 'first_md_chat',
    label: 'Chat with the MD for the first time',
    description: 'Meet Mr. Mwikila — your portfolio concierge.',
    completed: false,
  },
  {
    id: 'owner_intent',
    label: 'Pick your owner intent',
    description: 'Cashflow-first, growth, or exit-prep — pick one.',
    completed: false,
  },
  {
    id: 'install_starter_skills',
    label: 'Install 3 starter Skills',
    description: 'Curated by Mr. Mwikila based on your intent.',
    completed: false,
  },
  {
    id: 'schedule_daily_briefing',
    label: 'Schedule your first daily briefing',
    description: 'A 5-minute morning brief delivered however you like.',
    completed: false,
  },
]);

function newId(prefix: string): string {
  // crypto.randomUUID() (122 bits of entropy) replaces the predictable
  // Math.random()-based generator. Used for tenantId / ownerUserId / etc.
  return `${prefix}_${randomUUID()}`;
}

function markStep(
  steps: ReadonlyArray<OnboardingFlowStep>,
  id: OnboardingFlowStepId,
  meta: Readonly<Record<string, unknown>> = {},
): ReadonlyArray<OnboardingFlowStep> {
  return steps.map((s) =>
    s.id === id
      ? {
          ...s,
          completed: true,
          completedAt: new Date().toISOString(),
          meta: { ...(s.meta ?? {}), ...meta },
        }
      : s,
  );
}

function getSessionByTenant(tenantId: string): OnboardingFlowSession | null {
  return sessions.get(tenantId) ?? null;
}

function getSessionByToken(token: string): OnboardingFlowSession | null {
  const tenantId = sessionsByToken.get(token);
  if (!tenantId) return null;
  return getSessionByTenant(tenantId);
}

// Best-effort header-or-body resolver: signup returns a sessionToken; we
// accept either a bearer in `Authorization` (after the owner is logged in
// via auth.ts) OR `x-onboarding-session` so the still-anonymous post-signup
// page can drive the remaining endpoints before email verification.
function resolveSession(c: any): OnboardingFlowSession | null {
  const tokenHeader =
    c.req.header('x-onboarding-session') ??
    (c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  if (tokenHeader) {
    const byToken = getSessionByToken(tokenHeader);
    if (byToken) return byToken;
  }
  // Fallback: callers wired through the post-login authMiddleware will set
  // `c.var.auth` — we can resolve by tenantId. We keep this best-effort and
  // gateway-agnostic so unit tests don't have to mount the full middleware.
  const auth = c.get?.('auth');
  if (auth?.tenantId) return getSessionByTenant(String(auth.tenantId));
  return null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SignupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  country: z.string().min(2).max(3), // ISO-3166 alpha-2 or alpha-3
  businessName: z.string().min(1).max(200),
});

const FirstPropertySchema = z.object({
  address: z.string().min(1).max(500),
  unitCount: z.number().int().min(1).max(10_000),
  rentEstimate: z.number().nonnegative().max(1_000_000_000),
  currency: z.string().min(3).max(3).default('KES'),
});

const FirstTenantImportSchema = z.object({
  mode: z.enum(['manual', 'csv']),
  // Manual: a single tenant row. CSV: a parsed list (the FE parses
  // client-side before posting).
  tenants: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(40),
        email: z.string().email().max(255).optional(),
        unitLabel: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(500),
});

const FirstMdChatSchema = z.object({
  prompt: z.string().min(1).max(2_000).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();

// 1. POST /signup -----------------------------------------------------------
//
// CRITICAL #1 + #2 fix:
//   * Password is bcrypt-hashed (cost 10) and persisted in the credential
//     store (Phase D wire — pluggable to UserRepository at composition
//     root).
//   * Duplicate-email signup returns 409 Conflict with `loginUrl`. We
//     NEVER return the existing tenant's session token because that
//     would leak credentials to anyone who knows the email
//     (signup-replay → account takeover).
//   * Until email is confirmed via `/verify-email`, no session-token is
//     issued. The response carries `pendingEmailConfirmation: true` and
//     a one-shot `verificationToken` the FE can wire to the confirm
//     screen for E2E testability (in production this lands via an
//     email link, NOT in the HTTP response).
app.post('/signup', zValidator('json', SignupSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const body = c.req.valid('json');
  const normalizedEmail = body.email.trim().toLowerCase();

  // Duplicate-email defence (CRITICAL #2). Return 409 with a login URL
  // instead of leaking the existing session token.
  if (credentials.emailToTenantId.has(normalizedEmail)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'email-already-registered',
          message:
            'An account with this email already exists. Please sign in instead.',
          loginUrl: '/auth/login',
        },
      },
      409,
    );
  }

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
  const tenantId = newId('tn');
  const ownerUserId = newId('usr');
  const createdAt = new Date().toISOString();

  // Persist the credential atomically with the onboarding session. In
  // production composition the userRepo.create() insert lands here too,
  // wrapped in the same transaction.
  credentials.emailToTenantId.set(normalizedEmail, tenantId);
  credentials.tenantIdToCredential.set(tenantId, {
    ownerUserId,
    email: normalizedEmail,
    passwordHash,
    emailVerifiedAt: null,
    createdAt,
  });

  // Email-verification token. Until consumed, no sessionToken is issued.
  const verificationToken = newSessionToken();
  pendingEmailVerifications.set(verificationToken, {
    tenantId,
    email: normalizedEmail,
    issuedAtMs: Date.now(),
  });

  // Stage the onboarding session WITHOUT issuing a sessionToken. The
  // session row exists so we can resume after email confirmation.
  const session: OnboardingFlowSession = {
    id: newId('sess'),
    tenantId,
    ownerUserId,
    email: normalizedEmail,
    businessName: body.businessName.trim(),
    country: body.country.toUpperCase(),
    sessionToken: '', // empty until email confirmed
    createdAt,
    steps: DEFAULT_STEPS,
  };
  sessions.set(tenantId, session);

  return c.json(
    {
      success: true,
      data: {
        tenantId,
        ownerUserId,
        email: normalizedEmail,
        businessName: session.businessName,
        pendingEmailConfirmation: true,
        // In production, this is sent ONLY via the email-link channel.
        // The HTTP-response copy is gated behind NODE_ENV !== production
        // so test suites + the local-dev FE can drive the confirm step
        // without scraping mailcatcher.
        ...(process.env.NODE_ENV !== 'production'
          ? { verificationToken }
          : {}),
        steps: session.steps,
      },
    },
    201,
  );
}));

// 1b. POST /verify-email ----------------------------------------------------
//
// Consumes the one-shot verification token from /signup, marks the
// owner-credential row as email-verified, and ONLY then mints a
// crypto-grade session token the FE can use to drive the rest of the
// onboarding flow.
const VerifyEmailSchema = z.object({
  verificationToken: z.string().min(16).max(256),
});

app.post('/verify-email', zValidator('json', VerifyEmailSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const body = c.req.valid('json');
  const pending = pendingEmailVerifications.get(body.verificationToken);
  if (!pending) {
    return c.json(
      {
        success: false,
        error: {
          code: 'invalid-or-expired-verification-token',
          message: 'Verification link is invalid or has expired.',
        },
      },
      400,
    );
  }
  // HIGH-1 fix: do NOT burn the token before the credential lookup.
  // If the lookup misses (e.g. the user signed up on pod A and verified
  // on pod B in a multi-replica deploy where the in-memory store is
  // process-local), burning here strands the user — they cannot retry.
  // We burn ONLY AFTER we know the lookup will succeed.
  const credential = credentials.tenantIdToCredential.get(pending.tenantId);
  if (!credential) {
    return c.json(
      {
        success: false,
        error: {
          code: 'tenant-not-found',
          message: 'Owner credential record missing.',
        },
      },
      404,
    );
  }
  // One-shot — burn the token only after we have committed to using it.
  pendingEmailVerifications.delete(body.verificationToken);
  // Immutable update — replace the credential row with verifiedAt set.
  credentials.tenantIdToCredential.set(pending.tenantId, {
    ...credential,
    emailVerifiedAt: new Date().toISOString(),
  });

  const session = sessions.get(pending.tenantId);
  if (!session) {
    return c.json(
      {
        success: false,
        error: {
          code: 'session-not-found',
          message: 'Onboarding session missing.',
        },
      },
      404,
    );
  }
  // Mint a crypto-grade session token NOW (post-confirmation).
  const sessionToken = newSessionToken();
  const updated: OnboardingFlowSession = {
    ...session,
    sessionToken,
    steps: markStep(session.steps, 'verify_email', {
      verifiedAt: new Date().toISOString(),
    }),
  };
  sessions.set(pending.tenantId, updated);
  sessionsByToken.set(sessionToken, pending.tenantId);

  return c.json({
    success: true,
    data: {
      sessionToken,
      tenantId: updated.tenantId,
      ownerUserId: updated.ownerUserId,
      email: updated.email,
      businessName: updated.businessName,
      steps: updated.steps,
    },
  });
}));

// 2. POST /first-property ---------------------------------------------------
app.post(
  '/first-property',
  zValidator('json', FirstPropertySchema),
  withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
    const session = resolveSession(c);
    if (!session) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'Onboarding session not found. POST /signup first.',
          },
        },
        404,
      );
    }
    const body = c.req.valid('json');
    const propertyId = newId('prop');
    const nextSteps = markStep(session.steps, 'first_property', {
      propertyId,
      address: body.address,
      unitCount: body.unitCount,
      rentEstimate: body.rentEstimate,
      currency: body.currency,
    });
    const updated: OnboardingFlowSession = {
      ...session,
      firstPropertyId: propertyId,
      steps: nextSteps,
    };
    sessions.set(session.tenantId, updated);
    return c.json({
      success: true,
      data: {
        propertyId,
        steps: nextSteps,
      },
    });
  }),
);

// 3. POST /first-tenant-import ---------------------------------------------
app.post(
  '/first-tenant-import',
  zValidator('json', FirstTenantImportSchema),
  withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
    const session = resolveSession(c);
    if (!session) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_SESSION',
            message: 'Onboarding session not found. POST /signup first.',
          },
        },
        404,
      );
    }
    const body = c.req.valid('json');
    const imported = body.tenants.map((t) => ({
      ...t,
      id: newId('cust'),
    }));
    const nextSteps = markStep(session.steps, 'first_tenant_import', {
      mode: body.mode,
      count: imported.length,
    });
    const updated: OnboardingFlowSession = {
      ...session,
      steps: nextSteps,
    };
    sessions.set(session.tenantId, updated);
    return c.json({
      success: true,
      data: {
        imported: imported.length,
        tenants: imported,
        steps: nextSteps,
      },
    });
  }),
);

// 4. POST /first-md-chat ----------------------------------------------------
//   Kicks off the first MD conversation. Spawns the inline
//   welcome.coordinator sub-MD which greets the owner, surveys intent,
//   and suggests 3 starter Skills. This is the owner's first "wow"
//   moment — keep latency tight (<20s in E2E budget).
app.post('/first-md-chat', zValidator('json', FirstMdChatSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const session = resolveSession(c);
  if (!session) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NO_SESSION',
          message: 'Onboarding session not found. POST /signup first.',
        },
      },
      404,
    );
  }
  const body = c.req.valid('json');

  const result = await runWelcomeCoordinator({
    ownerEmail: session.email,
    businessName: session.businessName,
    country: session.country,
    ownerPrompt: body.prompt,
    previousIntent: session.intent,
  });

  const threadId = session.firstChatThreadId ?? newId('thr');
  const nextSteps = markStep(session.steps, 'first_md_chat', {
    threadId,
    welcomeMessageId: result.messageId,
  });
  const updated: OnboardingFlowSession = {
    ...session,
    firstChatThreadId: threadId,
    suggestedSkills: result.suggestedSkills.map((s) => s.slug),
    steps: nextSteps,
  };
  sessions.set(session.tenantId, updated);

  return c.json({
    success: true,
    data: {
      threadId,
      messageId: result.messageId,
      greeting: result.greeting,
      questions: result.intentQuestions,
      suggestedSkills: result.suggestedSkills,
      offerDailyBriefing: result.offerDailyBriefing,
      steps: nextSteps,
    },
  });
}));

// 5. GET /checklist ---------------------------------------------------------
app.get('/checklist', async (c) => {
  const session = resolveSession(c);
  if (!session) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NO_SESSION',
          message: 'Onboarding session not found. POST /signup first.',
        },
      },
      404,
    );
  }
  const completed = session.steps.filter((s) => s.completed).length;
  const total = session.steps.length;
  return c.json({
    success: true,
    data: {
      tenantId: session.tenantId,
      businessName: session.businessName,
      progress: {
        completed,
        total,
        percent: Math.round((completed / total) * 100),
      },
      steps: session.steps,
      intent: session.intent ?? null,
      suggestedSkills: session.suggestedSkills ?? [],
    },
  });
});

// Internal test surface — let tests force a known session into the store.
// Guarded by NODE_ENV so production never exposes it. This keeps the
// in-memory pilot store testable without exposing a private API.
if (process.env.NODE_ENV !== 'production') {
  app.post('/__test__/reset', withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, (c) => {
    sessions.clear();
    sessionsByToken.clear();
    pendingEmailVerifications.clear();
    credentials.emailToTenantId.clear();
    credentials.tenantIdToCredential.clear();
    return c.json({ success: true });
  }));
}

export const onboardingFlowRouter = app;
