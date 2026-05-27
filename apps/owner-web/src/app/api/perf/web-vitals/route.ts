/**
 * /api/perf/web-vitals — Web Vitals collector for owner-web.
 *
 * Receives sendBeacon JSON payloads from the WebVitalsReporter client
 * island. Validates shape and logs server-side.
 *
 * Edge runtime — anonymous side-channel; latency matters; no DB calls.
 *
 * Intelligence-loss audit: ZERO. Pure observer.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const WebVitalSchema = z.object({
  surface: z.string().min(1).max(50),
  name: z.enum(['LCP', 'INP', 'CLS', 'TTFB', 'FCP']),
  value: z.number().nonnegative().finite(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  id: z.string().min(1).max(120),
  delta: z.number().optional(),
  navigationType: z.string().optional(),
  attribution: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const text = await req.text();
    if (text.length > 16_384) {
      return NextResponse.json({ ok: false, error: 'payload-too-large' }, { status: 413 });
    }
    const json = JSON.parse(text);
    const parsed = WebVitalSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'bad-shape' }, { status: 400 });
    }
    console.log('[perf:web-vitals]', JSON.stringify(parsed.data)); // eslint-disable-line no-console -- reason: perf telemetry sink fallback; @borjie/observability adapter wired in a follow-up wave
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error('[perf:web-vitals] handler failed:', error); // eslint-disable-line no-console -- reason: edge route error path
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
