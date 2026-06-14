import { Hono } from 'hono';
import { z } from 'zod';
import {
  marketingPilotApplications,
  marketingContactSubmissions,
  marketingSubscriptions,
} from '@borjie/database';
import { createLogger } from '../utils/logger.js';

/**
 * Marketing-surface router.
 *
 * Tiny public surface that the @borjie/marketing site posts inbound
 * leads into. Lives under `/api/v1/marketing/*`. No auth middleware —
 * these endpoints are public by design (a prospect cannot have a
 * tenant yet).
 *
 *   - POST /pilot-application -> marketing_pilot_applications (migration 0146)
 *   - POST /contact           -> marketing_contact_submissions (migration 0359)
 *   - POST /subscribe         -> marketing_subscriptions       (migration 0359)
 *
 * Persistence model (all three handlers, R24 + KI-013):
 *   - Writes via drizzle when a DB binding is available on the context.
 *   - Falls back to structured-log-only when DB is unavailable so the
 *     dev / pre-DATABASE_URL bootstrap path still works (graceful
 *     degrade — a persistence failure must NOT block the lead).
 *   - The PII-scrubber in the logger masks `email` for the structured
 *     log fan-out regardless of DB persistence outcome.
 */
const moduleLogger = createLogger('marketing');

const PilotApplicationSchema = z.object({
  name: z.string().min(2).max(120),
  company: z.string().min(2).max(160),
  email: z.string().email().max(160),
  phone: z.string().min(6).max(30),
  portfolioSize: z.number().int().min(1).max(10_000),
  mineralFocus: z.string().min(2).max(60),
});

// Mirrors apps/marketing/src/app/api/contact/route.ts ContactSchema so the
// gateway re-validates the forwarded payload (never trust the proxy).
const ContactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  org: z.string().max(160).optional().default(''),
  kind: z.string().max(40).optional().default('general'),
  message: z.string().min(2).max(4_000),
});

// Mirrors apps/marketing/src/app/api/subscribe/route.ts SubscribeSchema.
const SubscribeSchema = z.object({
  email: z.string().email().max(160),
});

interface DbInsert {
  readonly insert: (t: unknown) => {
    readonly values: (v: Record<string, unknown>) => {
      readonly returning: () => Promise<readonly Record<string, unknown>[]>;
    };
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function makeApplicationId(): string {
  return makeId('pa');
}

/**
 * Resolve the inbound source IP + user-agent the same way the pilot
 * handler does, so contact/subscribe rows carry identical provenance.
 */
function requestProvenance(c: {
  req: { header: (name: string) => string | undefined };
}): { sourceIp: string | null; userAgent: string | null } {
  const sourceIp =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = c.req.header('user-agent') ?? null;
  return { sourceIp, userAgent };
}

const app = new Hono();

app.post('/pilot-application', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON' },
      },
      400,
    );
  }

  const parsed = PilotApplicationSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Pilot application failed validation',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  const id = makeApplicationId();
  const sourceIp =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = c.req.header('user-agent') ?? null;

  let persisted = false;
  const db = c.get('db' as never) as unknown as DbInsert | undefined;
  if (db && typeof db.insert === 'function') {
    try {
      await db
        .insert(marketingPilotApplications)
        .values({
          id,
          name: parsed.data.name,
          company: parsed.data.company,
          email: parsed.data.email,
          phone: parsed.data.phone,
          portfolioSize: parsed.data.portfolioSize,
          mineralFocus: parsed.data.mineralFocus,
          sourceIp,
          userAgent,
        })
        .returning();
      persisted = true;
    } catch (err) {
      // Persistence failure must NOT block the lead — the structured
      // log path below still gives the founder inbox a notification.
      moduleLogger.warn('pilot-application persistence failed', {
        company: parsed.data.company,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  moduleLogger.info('pilot application received', {
    id,
    persisted,
    company: parsed.data.company,
    email: parsed.data.email,
    portfolioSize: parsed.data.portfolioSize,
    mineralFocus: parsed.data.mineralFocus,
  });

  return c.json(
    { success: true, data: { received: true, id, persisted } },
    201,
  );
});

app.post('/contact', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON' },
      },
      400,
    );
  }

  const parsed = ContactSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Contact submission failed validation',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  const id = makeId('mc');
  const { sourceIp, userAgent } = requestProvenance(c);

  let persisted = false;
  const db = c.get('db' as never) as unknown as DbInsert | undefined;
  if (db && typeof db.insert === 'function') {
    try {
      await db
        .insert(marketingContactSubmissions)
        .values({
          id,
          name: parsed.data.name,
          email: parsed.data.email,
          org: parsed.data.org,
          kind: parsed.data.kind,
          message: parsed.data.message,
          sourceIp,
          userAgent,
        })
        .returning();
      persisted = true;
    } catch (err) {
      // Persistence failure must NOT block the lead — the structured
      // log path below still gives the founder inbox a notification.
      moduleLogger.warn('contact persistence failed', {
        kind: parsed.data.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  moduleLogger.info('contact submission received', {
    id,
    persisted,
    email: parsed.data.email,
    org: parsed.data.org,
    kind: parsed.data.kind,
  });

  return c.json(
    { success: true, data: { received: true, id, persisted } },
    201,
  );
});

app.post('/subscribe', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON' },
      },
      400,
    );
  }

  const parsed = SubscribeSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Subscription failed validation',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  const id = makeId('ms');
  const { sourceIp, userAgent } = requestProvenance(c);

  let persisted = false;
  const db = c.get('db' as never) as unknown as DbInsert | undefined;
  if (db && typeof db.insert === 'function') {
    try {
      await db
        .insert(marketingSubscriptions)
        .values({
          id,
          email: parsed.data.email,
          sourceIp,
          userAgent,
        })
        .returning();
      persisted = true;
    } catch (err) {
      // A duplicate email hits the case-insensitive unique index — that is
      // a benign already-subscribed, not a failure. Either way the lead is
      // not blocked; the structured log records the outcome.
      moduleLogger.warn('subscribe persistence failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  moduleLogger.info('subscription received', {
    id,
    persisted,
    email: parsed.data.email,
  });

  return c.json(
    { success: true, data: { received: true, id, persisted } },
    201,
  );
});

export { app as marketingRouter };
