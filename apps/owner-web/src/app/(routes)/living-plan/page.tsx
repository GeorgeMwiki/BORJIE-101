/**
 * Living plan — Mr. Mwikila's durable plan, the owner's lens.
 *
 * The Notion×Asana "living plan" surface: a calm health meter (open vs done,
 * overdue as a warning) over GTD-partitioned cards (Next actions · Waiting-for ·
 * Tickler/Upcoming · Someday · Overdue). Each item shows its trigger
 * ("due 1 Jul 2026" / "when royalty settles"), its status, and the proof that
 * closed it.
 *
 * Server component renders the locale-pure header; the client panel drives the
 * live fetch + meter + cards.
 *
 * Routes used (read-only):
 *   GET /api/v1/owner/living-plan/summary
 *   GET /api/v1/owner/living-plan/upcoming
 *   GET /api/v1/owner/living-plan/overdue
 *   GET /api/v1/owner/living-plan/deferred
 *   GET /api/v1/owner/living-plan/past
 *
 * Bilingual ABSOLUTE toggle: every label + title renders in exactly one
 * language for the active locale — never both, never a hardcoded 'en-US'.
 */

import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { LivingPlanPanel } from './living-plan-panel';

export const dynamic = 'force-dynamic';

export default async function LivingPlanPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <main className="px-8 py-8">
      <LivingPlanPanel initialLocale={locale} />
    </main>
  );
}
