import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * /api/chat — thin adapter between the LitFin-style widget shape and
 * Borjie's existing /api/v1/public/chat endpoint at the api-gateway.
 *
 * Widget posts:        { message, sessionId, language?, portalId?, currentRoute?, image? }
 * Gateway expects:     { sessionId, message, transcript?, visitorCountry? }
 */

export const runtime = 'nodejs';

const WidgetTurnSchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().min(1).max(160),
  language: z.enum(['en', 'sw']).optional(),
  portalId: z.string().max(40).optional(),
  currentRoute: z.string().max(240).optional(),
  image: z
    .object({
      data: z.string().max(8_000_000),
      mediaType: z.string().max(40),
      fileName: z.string().max(200),
    })
    .optional(),
});

function resolveGatewayBase(): string {
  const env = (
    process.env.NEXT_PUBLIC_API_GATEWAY_URL ??
    process.env.API_GATEWAY_URL ??
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (env.length > 0) return env;
  return 'http://localhost:4000';
}

export async function POST(req: Request): Promise<Response> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    return NextResponse.json(
      { error: 'unsupported_media_type' },
      { status: 415 },
    );
  }
  let parsed: z.infer<typeof WidgetTurnSchema>;
  try {
    const raw = (await req.json()) as unknown;
    parsed = WidgetTurnSchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_payload',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 400 },
    );
  }

  const upstream = `${resolveGatewayBase()}/api/v1/public/chat`;
  const wantsStream = (req.headers.get('accept') ?? '').includes(
    'text/event-stream',
  );

  const upstreamBody = {
    sessionId: parsed.sessionId,
    message: parsed.message,
  };

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: wantsStream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });

    if (wantsStream && upstreamRes.body) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          'content-type':
            upstreamRes.headers.get('content-type') ?? 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    }

    const text = await upstreamRes.text();
    let reply = text;
    try {
      const json = JSON.parse(text) as { reply?: string; text?: string };
      reply = json.reply ?? json.text ?? text;
    } catch {
      /* plain text fallback */
    }
    return NextResponse.json(
      { reply, sessionId: parsed.sessionId },
      { status: upstreamRes.status },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'upstream_unreachable',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 502 },
    );
  }
}
