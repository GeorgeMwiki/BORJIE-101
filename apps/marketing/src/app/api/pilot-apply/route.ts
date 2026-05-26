import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * /api/pilot-apply — Next route handler that forwards a validated
 * pilot application to the Borjie api-gateway.
 *
 * The api-gateway side ships in `services/api-gateway/src/routes/
 * marketing.hono.ts` (stub) so cold-start failure modes are wired up
 * before we accept the first pilot in production.
 *
 * Validation lives here (zod) — we never proxy raw user input
 * unchecked. Errors return RFC 7807-shaped envelopes so the form can
 * surface them to the operator.
 */
const ApplicationSchema = z.object({
  name: z.string().min(2).max(120),
  company: z.string().min(2).max(160),
  email: z.string().email().max(160),
  phone: z.string().min(6).max(30),
  portfolioSize: z.number().int().min(1).max(10_000),
  mineralFocus: z.string().min(2).max(60),
});

const GATEWAY_URL =
  process.env.BORJIE_API_GATEWAY_URL ?? 'http://localhost:3000';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ApplicationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid pilot application payload',
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      `${GATEWAY_URL}/api/v1/marketing/pilot-application`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
    ).catch((err: unknown) => {
      // Gateway unreachable — surface a recognisable error rather than
      // a 500. We still consider the application captured in our own
      // logs so the operator gets a friendly success path during
      // development.
      console.error('pilot-apply: upstream unreachable', err);
      return new Response(null, { status: 503 });
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('pilot-apply: upstream rejected', upstream.status, detail);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UPSTREAM_REJECTED',
            message: 'Pilot application could not be saved upstream.',
          },
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('pilot-apply failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL', message: 'Unexpected error' },
      },
      { status: 500 },
    );
  }
}
