import { Hono } from 'hono';
import { z } from 'zod';
import { marketingPilotApplications } from '@borjie/database';
import { createLogger } from '../utils/logger.js';

/**
 * Marketing-surface router.
 *
 * Tiny public surface that the @borjie/marketing site posts pilot
 * applications into. Lives under `/api/v1/marketing/*`. No auth
 * middleware — these endpoints are public by design (a prospect
 * cannot have a tenant yet).
 *
 * Persistence shipped 2026-05-29 (R24 closure):
 *   - Writes to `marketing_pilot_applications` (migration 0146) via
 *     drizzle when a DB binding is available on the context.
 *   - Falls back to structured-log-only when DB is unavailable so the
 *     dev / pre-DATABASE_URL bootstrap path still works.
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

interface DbInsert {
  readonly insert: (t: unknown) => {
    readonly values: (v: Record<string, unknown>) => {
      readonly returning: () => Promise<readonly Record<string, unknown>[]>;
    };
  };
}

function makeApplicationId(): string {
  return `pa_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
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

export { app as marketingRouter };
