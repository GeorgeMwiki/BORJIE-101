import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';

/**
 * Marketing-surface router.
 *
 * Tiny public surface that the @borjie/marketing site posts pilot
 * applications into. Lives under `/api/v1/marketing/*`. No auth
 * middleware — these endpoints are public by design (a prospect
 * cannot have a tenant yet).
 *
 * Persistence (write to `marketing.pilot_applications` + notify
 * pilot@borjie.co.tz) is tracked in `Docs/KNOWN_ISSUES.md` as
 * KI-MARKETING-1; for now we accept, validate, log via the structured
 * logger, and return `{ success: true }` so the marketing site has a
 * functioning end-to-end submission path during pre-launch.
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

  // Persistence + notification wiring is tracked as KI-MARKETING-1 in
  // Docs/KNOWN_ISSUES.md. For now we acknowledge via the structured
  // logger so the marketing surface has a working end-to-end path in
  // dev/staging. The PII-scrubber in the logger masks `email` for us.
  moduleLogger.info('pilot application received', {
    company: parsed.data.company,
    email: parsed.data.email,
    portfolioSize: parsed.data.portfolioSize,
    mineralFocus: parsed.data.mineralFocus,
  });

  return c.json({ success: true, data: { received: true } }, 201);
});

export { app as marketingRouter };
