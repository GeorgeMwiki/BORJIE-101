import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * /api/subscribe — Next route handler that forwards a validated blog
 * subscribe email to the Borjie api-gateway.
 *
 * The subscribe band (`src/app/blog/page.tsx`) is server-rendered and
 * posts natively (`<form action="/api/subscribe" method="post">`), so
 * the body arrives URL-encoded. We parse it, validate (zod — we never
 * proxy raw user input unchecked), forward server-to-server to the
 * gateway, then 303-redirect the browser back to the blog page with a
 * status flag so the native POST never leaves the visitor on a raw JSON
 * page.
 *
 * The api-gateway side ships in `services/api-gateway/src/routes/
 * marketing.hono.ts` (stub) so cold-start failure modes are wired up
 * before we accept the first subscriber in production.
 */
const SubscribeSchema = z.object({
  email: z.string().email().max(160),
});

const GATEWAY_URL =
  process.env.BORJIE_API_GATEWAY_URL ??
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ??
  'http://localhost:3000';

function redirectBack(req: Request, status: 'ok' | 'invalid' | 'error') {
  return NextResponse.redirect(
    new URL(`/blog?subscribed=${status}`, req.url),
    { status: 303 },
  );
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const parsed = SubscribeSchema.safeParse({ email: form.get('email') });
    if (!parsed.success) {
      return redirectBack(req, 'invalid');
    }

    const upstream = await fetch(`${GATEWAY_URL}/api/v1/marketing/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    }).catch((err: unknown) => {
      // Gateway unreachable — surface a recognisable error rather than
      // a 500. We still consider the subscription captured in our own
      // logs so the operator gets a friendly path during development.
      console.error('subscribe: upstream unreachable', err);
      return new Response(null, { status: 503 });
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('subscribe: upstream rejected', upstream.status, detail);
      return redirectBack(req, 'error');
    }

    return redirectBack(req, 'ok');
  } catch (error) {
    console.error('subscribe failed:', error);
    return redirectBack(req, 'error');
  }
}
