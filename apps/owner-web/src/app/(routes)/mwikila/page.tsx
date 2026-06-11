import { redirect } from 'next/navigation';

/**
 * `/mwikila` index — "Open Mr. Mwikila".
 *
 * The owner-facing MD chat lives at `/ask` (O-W-23 — the LIVE
 * `POST /api/v1/brain/turn` surface). Several cockpit CTAs ("Open Mr. Mwikila"
 * on payroll / roster / workforce-openings) deep-link to `/mwikila`, optionally
 * with a `?prompt=` seed; before this index they 404'd because only the
 * `/mwikila/inbox` and `/mwikila/delegation` children existed.
 *
 * This index forwards to the chat, preserving EVERY query param so the prompt
 * seed survives. The `inbox` and `delegation` children keep their own routes
 * (exact-segment routing — this index only handles exactly `/mwikila`).
 */
export default async function MwikilaIndexPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      qs.set(key, value);
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === 'string'
    ) {
      qs.set(key, value[0]);
    }
  }
  const query = qs.toString();
  redirect(query ? `/ask?${query}` : '/ask');
}
