import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * /api/contact — Next route handler that forwards a validated
 * contact-form submission to the Borjie api-gateway.
 *
 * The contact form (`src/app/contact/page.tsx`) is server-rendered and
 * posts natively (`<form action="/api/contact" method="post">`), so the
 * body arrives URL-encoded. We parse it, validate (zod — we never proxy
 * raw user input unchecked), forward server-to-server to the gateway,
 * then 303-redirect the browser back to the contact page with a status
 * flag so the native POST never leaves the visitor on a raw JSON page.
 *
 * The api-gateway side ships in `services/api-gateway/src/routes/
 * marketing.hono.ts` (stub) so cold-start failure modes are wired up
 * before we accept the first inquiry in production.
 */
const ContactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  org: z.string().max(160).optional().default(''),
  kind: z.string().max(40).optional().default('general'),
  message: z.string().min(2).max(4_000),
});

const GATEWAY_URL =
  process.env.BORJIE_API_GATEWAY_URL ??
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ??
  'http://localhost:3000';

function redirectBack(req: Request, status: 'ok' | 'invalid' | 'error') {
  return NextResponse.redirect(
    new URL(`/contact?sent=${status}`, req.url),
    { status: 303 },
  );
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const parsed = ContactSchema.safeParse({
      name: form.get('name'),
      email: form.get('email'),
      org: form.get('org') ?? undefined,
      kind: form.get('kind') ?? undefined,
      message: form.get('message'),
    });
    if (!parsed.success) {
      return redirectBack(req, 'invalid');
    }

    const upstream = await fetch(`${GATEWAY_URL}/api/v1/marketing/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    }).catch((err: unknown) => {
      // Gateway unreachable — surface a recognisable error rather than
      // a 500. We still consider the inquiry captured in our own logs
      // so the operator gets a friendly path during development.
      console.error('contact: upstream unreachable', err);
      return new Response(null, { status: 503 });
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('contact: upstream rejected', upstream.status, detail);
      return redirectBack(req, 'error');
    }

    return redirectBack(req, 'ok');
  } catch (error) {
    console.error('contact failed:', error);
    return redirectBack(req, 'error');
  }
}
