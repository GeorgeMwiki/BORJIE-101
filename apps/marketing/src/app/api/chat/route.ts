import { NextResponse } from 'next/server';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { extractReplyFromUpstream } from './sse-parse';

/**
 * /api/chat — thin adapter between the LitFin-style widget shape and
 * Borjie's existing /api/v1/public/chat endpoint at the api-gateway.
 *
 * Widget posts:        { message, sessionId, language?, portalId?, currentRoute?, image? }
 * Gateway expects:     { sessionId, message, transcript?, visitorCountry? }
 *
 * Auth: mints a short-lived service JWT with role=PUBLIC because the
 * gateway now requires auth on all /api/v1/* routes (even /public/*).
 * The PUBLIC role grants no tenant access, only Mr. Mwikila public chat.
 *
 * CONVERSATIONAL-ONLY: this BFF is a pure proxy — it forwards the user's
 * message to the gateway and returns the gateway's prose reply. NO server-
 * synthesised concept_card / ui_block / structured artifacts. The floating
 * concierge is a chat surface, not a UI surface; mining-domain knowledge
 * surfaces as the model's prose. (The earlier emitLearningBlocks heuristic
 * was removed in PR drive-to-zero.)
 */

export const runtime = 'nodejs';

function mintPublicServiceJwt(sessionId: string): string {
  const secret =
    process.env.JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET ?? '';
  if (!secret) {
    throw new Error('JWT_SECRET unset — public chat cannot mint service token');
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      userId: `public-chat-${sessionId.slice(0, 24)}`,
      tenantId: null,
      role: 'PUBLIC',
      iat: now,
      exp: now + 60, // 60s — single request lifetime
    },
    secret,
    { algorithm: 'HS256' },
  );
}

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

/* SSE parsing helpers (extractMessageChunksFromSse, extractReplyFromUpstream)
 * live in ./sse-parse.ts because Next.js 15 route files only allow
 * specific named exports (HTTP methods, runtime, dynamic, etc.).
 */

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

// Note: this route previously synthesised inline `concept_card` / `ui_block`
// objects from a keyword heuristic and injected them into the JSON response,
// directly contradicting the floating-concierge "CONVERSATIONAL ONLY" promise
// the system prompt enforces. Removed (PR drive-to-zero) — the BFF is now a
// pure proxy: it forwards the user's message to the gateway and returns the
// gateway's prose reply, nothing else. Mining-domain knowledge surfaces as
// the model's prose, not as server-injected cards.

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
    // Forward the active locale so the gateway pins Mr. Mwikila's REPLY to it.
    // Without this the gateway defaults to 'en' and answers a Swahili visitor
    // in English (zero-mix canon violation in the chat content itself).
    language: parsed.language ?? 'en',
  };

  let serviceToken: string;
  try {
    serviceToken = mintPublicServiceJwt(parsed.sessionId);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'auth_unconfigured',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 },
    );
  }

  const language = parsed.language ?? 'en';

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: wantsStream ? 'text/event-stream' : 'application/json',
        authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    if (wantsStream && upstreamRes.body) {
      // SSE pass-through: stream the gateway's response body through to the
      // widget unchanged.
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
    const upstreamCt = upstreamRes.headers.get('content-type') ?? '';
    const reply = extractReplyFromUpstream(text, upstreamCt);
    return NextResponse.json(
      {
        reply,
        sessionId: parsed.sessionId,
      },
      { status: upstreamRes.status },
    );
  } catch (err) {
    // Gateway unreachable: always fall back to direct-Anthropic so the
    // widget gets a real Mr. Mwikila reply rather than a 502. Mirrors
    // BN's dual-mode pattern from #276. If both fail, surface 503 with
    // a structured error so the widget can render its own degraded UX.
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (anthropicKey) {
      try {
        // Conversational-only floating concierge: same rule as the gateway's
        // public-chat system prompt — no tables, no code fences, no <ui_block>
        // tags, no bullet lists, no HTML. Plain prose, 1-4 short sentences.
        const CONVERSATIONAL_ONLY =
          language === 'sw'
            ? ' Hii ni dirisha la mazungumzo. Andika kama mshauri mtaalamu anayejibu DM: prose tu, sentensi 1-4 fupi, malizia kwa swali. KAMWE usitumie meza (no | col |), code fences, <ui_block>, [QUICK_REPLIES], orodha za bullet, au lebo za HTML.'
            : ' This is a floating chat panel. Write like a senior advisor typing back in a DM: prose only, 1-4 short sentences, end with a question. NEVER use tables (no | col |), code fences, <ui_block>, [QUICK_REPLIES], bullet lists, or HTML tags.';
        const system =
          (language === 'sw'
            ? 'Wewe ni Mr. Mwikila, Mkurugenzi wa Madini wa AI wa Borjie. Jibu kwa Kiswahili pekee, kwa kifupi, joto na kwa msaada. Ukijitambulisha, jitambulishe kwa maneno YAKO ya asili kila mara, kamwe usikariri sentensi ya kujitangaza. Unaendesha estate ya madini kwa wamiliki: leseni na kuhuisha, mrabaha, wafanyakazi na zamu, hazina na dirisha la kuuza madini, na kufuata Tume ya Madini, TRA na BoT. Jibu maswali yanayohusu Borjie na Mr. Mwikila pekee; kataa kwa heshima mada zisizohusiana na kamwe usijadili bidhaa nyingine.'
            : "You are Mr. Mwikila, Borjie's AI mining MD. Reply in English only, concise, warm and useful. When you introduce yourself, do it in your OWN fresh words every time; never recite a fixed positioning sentence. You run the mining estate for owners: licences and renewals, royalty, workforce and shifts, treasury and the mineral-sale window, and compliance with the Mining Commission, TRA and BoT. Only answer questions about Borjie and Mr. Mwikila; politely decline unrelated topics and never discuss other products.") +
          CONVERSATIONAL_ONLY;
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 600,
            system,
            messages: [{ role: 'user', content: parsed.message }],
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (anthropicRes.ok) {
          const data = (await anthropicRes.json()) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const reply = (data.content ?? [])
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text as string)
            .join('\n')
            .trim();
          if (reply.length === 0) {
            // Empty Anthropic reply — surface as 503 with a structured
            // error code so the widget renders its own degraded state
            // instead of showing a hardcoded "(no response)" string.
            return NextResponse.json(
              {
                error: 'ai_empty_reply',
                detail: 'anthropic_returned_empty_content',
                sessionId: parsed.sessionId,
              },
              { status: 503 },
            );
          }
          return NextResponse.json(
            {
              reply,
              sessionId: parsed.sessionId,
              degraded: { mode: 'direct_anthropic', reason: 'gateway_unreachable' },
            },
            { status: 200 },
          );
        }
      } catch {
        // Fall through to structured 503 below.
      }
    }
    return NextResponse.json(
      {
        error: 'ai_unavailable',
        detail:
          anthropicKey ? 'gateway_down_and_anthropic_failed' : 'ANTHROPIC_API_KEY missing',
        sessionId: parsed.sessionId,
      },
      { status: 503 },
    );
  }
}
