/**
 * DecisionTrace list view (admin replay UI) — INV-A / FIRE-2.
 *
 * METADATA-ONLY by construction. The previous implementation read
 * `decision_traces` content directly via the `SUPABASE_SERVICE_ROLE_KEY`
 * (RLS-bypass, for any `?tenant=`, with no break-glass gate) inside this
 * public Next.js app. That crossed the INV-A control-plane wall AND held the
 * service-role key in a browser-facing surface.
 *
 * It now renders a thin shell over a client component that fetches the
 * metadata-only gateway projection
 * (`GET /api/v1/mining/internal/decision-trace`) using the platform-session
 * cookie. No service-role key lives in admin-web anymore. Decision CONTENT is
 * served only on the detail page under a tenant-consented break-glass grant.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { DecisionTraceListClient } from './DecisionTraceListClient';

export const dynamic = 'force-dynamic';

// Header copy is resolved on the SERVER from the same cookie that seeds the
// client locale, so SSR and the client's first paint render the SAME language
// (zero-mix canon — never an English header over a Swahili AdminShell).
const HEADER = {
  title: { en: 'Decision Trace Replay', sw: 'Urejeshaji wa Ufuatiliaji wa Maamuzi' },
  subtitle: {
    en: 'Structured audit replay for brain decisions, four-eye approvals, payouts, and tenant resolution. Metadata-only; content requires break-glass consent.',
    sw: 'Urejeshaji wa ukaguzi uliopangwa kwa maamuzi ya ubongo, idhini za macho-manne, malipo, na utatuzi wa mteja. Metadata-tu; maudhui yanahitaji idhini ya dharura.',
  },
} as const;

export default async function DecisionTraceListPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <DecisionTraceListClient initialLocale={locale} />
    </PageShell>
  );
}
