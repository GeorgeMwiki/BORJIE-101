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
 *   2. POST /first-site            — adds the first mining site (name,
 *                                    mineral, licence number, region)
 *   3. POST /first-workforce-import — bulk import OR manual one-worker
 *                                    entry
 *   4. POST /first-md-chat         — kicks off the first MD conversation
 *                                    with a curated welcome prompt; spawns
 *                                    the inline welcome.coordinator
 *                                    sub-MD which surveys intent and
 *                                    suggests 3 Skills
 *   5. GET  /checklist             — returns the 8-step onboarding
 *                                    checklist + per-step completion state
 *
 * Storage: Drizzle when a db handle is present (DATABASE_URL configured);
 * in-process in-memory store when DATABASE_URL is missing (dev/test mode).
 * This pattern mirrors brain-tab-loop-wiring.ts and calendar-wiring.ts.
 * KI-013 is closed by this change.
 *
 * HIGH-1 (audit .audit/post-pr90-api-mcp-bug-sweep.md): The multi-pod
 * email-verification split-brain risk is fully resolved by Drizzle
 * persistence — all pods share the same Postgres rows. The one-shot
 * token hardening (don't burn before credential lookup) is preserved.
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
import { logger } from '../utils/logger';
import {
  createInMemoryOnboardingStore,
  createDrizzleOnboardingStore,
  DuplicateEmailError,
  type OnboardingStore,
  type OnboardingSession,
  type OnboardingFlowStep,
  type OnboardingFlowStepId,
} from './onboarding-store';

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/** Cryptographically-strong session token (32 bytes → 43 base64url chars). */
function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Bcrypt cost factor — kept at 10 for parity with auth.ts. */
const BCRYPT_COST = 10;

/** Module-singleton in-memory store. Used when DATABASE_URL is absent. */
const sharedInMemoryStore: OnboardingStore = createInMemoryOnboardingStore();

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

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
    id: 'first_site',
    label: 'Add your first mining site',
    description: 'Tell us the site name, mineral, and licence number.',
    completed: false,
  },
  {
    id: 'first_workforce_import',
    label: 'Import your workforce',
    description: 'CSV upload or add one worker manually.',
    completed: false,
  },
  {
    id: 'first_md_chat',
    label: 'Chat with the MD for the first time',
    description: 'Meet Mr. Mwikila — your mining-estate concierge.',
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

// ---------------------------------------------------------------------------
// Store resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the right store for this request context.
 * If a db handle is in context, use Drizzle. Otherwise fall back to the
 * process-level in-memory singleton (dev / test mode).
 */
function resolveStore(c: { get(key: string): unknown }): OnboardingStore {
  const db = c.get('db');
  if (db != null) {
    return createDrizzleOnboardingStore(db);
  }
  return sharedInMemoryStore;
}

// ---------------------------------------------------------------------------
// Session resolver (header-first; auth fallback)
// ---------------------------------------------------------------------------

async function resolveSession(
  c: any,
  store: OnboardingStore,
): Promise<OnboardingSession | null> {
  const tokenHeader =
    c.req.header('x-onboarding-session') ??
    (c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  if (tokenHeader) {
    const byToken = await store.getSessionByToken(tokenHeader);
    if (byToken) return byToken;
  }
  const auth = c.get?.('auth');
  if (auth?.tenantId) return store.getSessionByTenant(String(auth.tenantId));
  return null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SignupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  country: z.string().min(2).max(3),
  businessName: z.string().min(1).max(200),
});

const FirstSiteSchema = z.object({
  siteName: z.string().min(1).max(200),
  mineral: z.string().min(1).max(80),
  licenceNumber: z.string().min(1).max(120),
  region: z.string().min(1).max(120),
});

const FirstWorkforceImportSchema = z.object({
  mode: z.enum(['manual', 'csv']),
  workers: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z.string().min(5).max(40),
        email: z.string().email().max(255).optional(),
        role: z.string().min(1).max(100),
        siteLabel: z.string().min(1).max(120),
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

// 1. POST /signup -------------------------------------------------------------
//
// CRITICAL #1 + #2:
//   * Password is bcrypt-hashed (cost 10).
//   * Duplicate-email signup returns 409 Conflict with `loginUrl`.
//   * Until email is confirmed via `/verify-email`, no session-token is
//     issued. The response carries `pendingEmailConfirmation: true`.
app.post('/signup', zValidator('json', SignupSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const body = c.req.valid('json');
  const normalizedEmail = body.email.trim().toLowerCase();
  const store = resolveStore(c);

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
  const tenantId = newId('tn');
  const ownerUserId = newId('usr');
  const createdAt = new Date().toISOString();

  try {
    await store.createCredential({
      tenantId,
      ownerUserId,
      email: normalizedEmail,
      passwordHash,
      emailVerifiedAt: null,
      createdAt,
    });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
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
    logger.error({ err, email: normalizedEmail }, 'signup credential insert failed');
    throw err;
  }

  const verificationToken = newSessionToken();
  await store.createVerification(verificationToken, {
    tenantId,
    email: normalizedEmail,
    issuedAtMs: Date.now(),
  });

  const session: OnboardingSession = {
    id: newId('sess'),
    tenantId,
    ownerUserId,
    email: normalizedEmail,
    businessName: body.businessName.trim(),
    country: body.country.toUpperCase(),
    sessionToken: '',
    createdAt,
    steps: DEFAULT_STEPS,
  };
  await store.createSession(session);

  return c.json(
    {
      success: true,
      data: {
        tenantId,
        ownerUserId,
        email: normalizedEmail,
        businessName: session.businessName,
        pendingEmailConfirmation: true,
        ...(process.env.NODE_ENV !== 'production'
          ? { verificationToken }
          : {}),
        steps: session.steps,
      },
    },
    201,
  );
}));

// 1b. POST /verify-email ------------------------------------------------------
//
// Consumes the one-shot verification token, marks the credential
// email-verified, and ONLY then mints a crypto-grade session token.
const VerifyEmailSchema = z.object({
  verificationToken: z.string().min(16).max(256),
});

app.post('/verify-email', zValidator('json', VerifyEmailSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const body = c.req.valid('json');
  const store = resolveStore(c);

  // HIGH-1 fix: look up WITHOUT burning first, so a miss doesn't strand
  // the user (multi-pod race on old in-memory code; now irrelevant with
  // Drizzle, but preserved as defence-in-depth).
  const pending = await store.getVerification(body.verificationToken);
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

  const credential = await store.getCredentialByTenant(pending.tenantId);
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

  // Burn the token only AFTER confirming the credential exists.
  const consumed = await store.consumeVerification(body.verificationToken);
  if (!consumed) {
    // Race: another request consumed it between our getVerification and here.
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

  await store.markCredentialEmailVerified(
    pending.tenantId,
    new Date().toISOString(),
  );

  const session = await store.getSessionByTenant(pending.tenantId);
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

  const sessionToken = newSessionToken();
  const updated = await store.updateSession(pending.tenantId, {
    sessionToken,
    steps: markStep(session.steps, 'verify_email', {
      verifiedAt: new Date().toISOString(),
    }),
  });

  if (!updated) {
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

  return c.json({
    success: true,
    data: {
      sessionToken: updated.sessionToken,
      tenantId: updated.tenantId,
      ownerUserId: updated.ownerUserId,
      email: updated.email,
      businessName: updated.businessName,
      steps: updated.steps,
    },
  });
}));

// 2. POST /first-site ---------------------------------------------------------
app.post(
  '/first-site',
  zValidator('json', FirstSiteSchema),
  withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
    const store = resolveStore(c);
    const session = await resolveSession(c, store);
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
    const siteId = newId('site');
    const nextSteps = markStep(session.steps, 'first_site', {
      siteId,
      siteName: body.siteName,
      mineral: body.mineral,
      licenceNumber: body.licenceNumber,
      region: body.region,
    });
    await store.updateSession(session.tenantId, {
      firstSiteId: siteId,
      steps: nextSteps,
    });
    return c.json({
      success: true,
      data: {
        siteId,
        steps: nextSteps,
      },
    });
  }),
);

// 3. POST /first-workforce-import ---------------------------------------------
app.post(
  '/first-workforce-import',
  zValidator('json', FirstWorkforceImportSchema),
  withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
    const store = resolveStore(c);
    const session = await resolveSession(c, store);
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
    const imported = body.workers.map((w) => ({
      ...w,
      id: newId('emp'),
    }));
    const nextSteps = markStep(session.steps, 'first_workforce_import', {
      mode: body.mode,
      count: imported.length,
    });
    await store.updateSession(session.tenantId, { steps: nextSteps });
    return c.json({
      success: true,
      data: {
        imported: imported.length,
        workers: imported,
        steps: nextSteps,
      },
    });
  }),
);

// 4. POST /first-md-chat ------------------------------------------------------
app.post('/first-md-chat', zValidator('json', FirstMdChatSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const store = resolveStore(c);
  const session = await resolveSession(c, store);
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

  const welcomeInput: Parameters<typeof runWelcomeCoordinator>[0] = {
    ownerEmail: session.email,
    businessName: session.businessName,
    country: session.country,
    ownerPrompt: body.prompt,
  };
  if (session.intent !== undefined) {
    (welcomeInput as { previousIntent?: typeof session.intent }).previousIntent =
      session.intent;
  }
  const result = await runWelcomeCoordinator(welcomeInput);
  const threadId = session.firstChatThreadId ?? newId('thr');
  const nextSteps = markStep(session.steps, 'first_md_chat', {
    threadId,
    welcomeMessageId: result.messageId,
  });
  await store.updateSession(session.tenantId, {
    firstChatThreadId: threadId,
    suggestedSkills: result.suggestedSkills.map((s) => s.slug),
    steps: nextSteps,
  });

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

// 5. GET /checklist -----------------------------------------------------------
app.get('/checklist', async (c) => {
  const store = resolveStore(c);
  const session = await resolveSession(c, store);
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

// Internal test surface — resets the in-memory singleton.
// Guarded by NODE_ENV so production never exposes it.
if (process.env.NODE_ENV !== 'production') {
  app.post('/__test__/reset', withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
    await sharedInMemoryStore.reset();
    return c.json({ success: true });
  }));
}

export const onboardingFlowRouter = app;
