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
 * Inline learning blocks (narrow port of LitFin's chat-message-level
 * learning pattern): when the user's message touches a known mining
 * topic, this route appends one `concept_card` or `ui_block` to the
 * response under `blocks`. The widget renders these inline via
 * InlineLearningBlocks. This does NOT port LitFin's stepper / classroom
 * / adaptive-layout framework — only the chat-message-level pattern.
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

// ─── Inline learning-block generator (narrow port) ───────────────

interface ConceptCardBlock {
  readonly type: 'concept_card';
  readonly title: string;
  readonly summary: string;
  readonly keyPoints?: ReadonlyArray<string>;
  readonly citation?: string;
}

interface UiBlock {
  readonly type: 'ui_block';
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

type InlineChatBlock = ConceptCardBlock | UiBlock;

/**
 * Heuristic-based learning-block emitter for Borjie's mining domain.
 * Detects mining concept triggers in the user message and emits an
 * inline `concept_card` or `ui_block`. Pure function — no LLM call so
 * latency stays at the gateway's baseline. Future iterations can ask
 * the gateway to emit blocks server-side; this is the narrow MVP.
 */
function emitLearningBlocks(
  userMessage: string,
  language: 'en' | 'sw',
): ReadonlyArray<InlineChatBlock> {
  const msg = userMessage.toLowerCase();

  // PML / Primary Mining Licence
  if (/\bpml\b|primary mining|leseni ya msingi/.test(msg)) {
    const card: ConceptCardBlock =
      language === 'sw'
        ? {
            type: 'concept_card',
            title: 'Leseni ya Msingi ya Madini (PML)',
            summary:
              'Leseni ya msingi inaruhusu uchimbaji wa madini katika eneo lisilozidi hekta 10. Inatolewa na Tume ya Madini chini ya Sheria ya Madini ya 2010.',
            keyPoints: [
              'Eneo: kiwango cha juu hekta 10',
              'Muda: miaka 7, inarejeshwa',
              'Ada ya mwaka: TZS 50,000 kwa hekta',
              'Inakiwa wenyeji wa Tanzania pekee',
            ],
            citation: 'Sheria ya Madini ya 2010, Kifungu cha 46',
          }
        : {
            type: 'concept_card',
            title: 'Primary Mining Licence (PML) basics',
            summary:
              'A PML permits small-scale mining over an area not exceeding 10 hectares. Issued by the Mining Commission under the Mining Act 2010.',
            keyPoints: [
              'Area cap: 10 hectares maximum',
              'Term: 7 years, renewable',
              'Annual rent: TZS 50,000 per hectare',
              'Tanzanian citizens only',
            ],
            citation: 'Mining Act 2010, Section 46',
          };
    return [card];
  }

  // Royalty rate
  if (/royalty|mrabaha|royalti/.test(msg)) {
    const card: ConceptCardBlock =
      language === 'sw'
        ? {
            type: 'concept_card',
            title: 'Viwango vya Mrabaha wa Madini',
            summary:
              'Mrabaha hulipwa kwa mauzo ghafi ya madini. Viwango vinatofautiana kulingana na aina ya madini.',
            keyPoints: [
              'Dhahabu, fedha, platinum: 6%',
              'Almasi: 5%',
              'Madini ya viwanda (chokaa, chumvi): 3%',
              'Madini ya ujenzi: 1%',
            ],
            citation: 'Sheria ya Madini 2010, Jedwali la Tatu',
          }
        : {
            type: 'concept_card',
            title: 'Mining royalty rates (Tanzania)',
            summary:
              'Royalty is calculated on the gross value of minerals sold. Rates vary by mineral category.',
            keyPoints: [
              'Gold, silver, platinum group: 6%',
              'Diamonds: 5%',
              'Industrial minerals (gypsum, salt): 3%',
              'Building materials: 1%',
            ],
            citation: 'Mining Act 2010, Third Schedule',
          };
    const calc: UiBlock = {
      type: 'ui_block',
      kind: 'royalty_calculator',
      payload: {
        mineral: 'Gold',
        rate: 6,
        grossSales: 10_000_000,
        currency: 'TZS',
      },
    };
    return [card, calc];
  }

  return [];
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
  const blocks = emitLearningBlocks(parsed.message, language);

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
      // SSE pass-through: blocks are not streamed for the MVP — the
      // widget falls back to JSON for any turn that triggers blocks.
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
        ...(blocks.length > 0 ? { blocks } : {}),
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
        const system =
          language === 'sw'
            ? 'Wewe ni Mr. Mwikila, AI Managing Director wa Borjie kwa mgodi wa Tanzania. Jibu kwa Kiswahili, mfupi, mwenye msaada. Wamiliki wa PML/ML/SML wanakuhitaji.'
            : "You are Mr. Mwikila, Borjie's AI Mining Managing Director for Tanzania. Help PML, ML and SML owners run their mines better. Keep replies concise, warm and useful.";
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
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
          return NextResponse.json(
            {
              reply: reply || '(no response)',
              sessionId: parsed.sessionId,
              ...(blocks.length > 0 ? { blocks } : {}),
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
        ...(blocks.length > 0 ? { blocks } : {}),
      },
      { status: 503 },
    );
  }
}
