import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

/**
 * Owner-web — notifications inbox (parity with workforce-mobile +
 * buyer-mobile). Shows the live SSE event stream the owner cockpit
 * has consumed during the current session.
 *
 * Out-of-app delivery: web push subscription is registered by
 * ServiceWorkerRegister (after NEXT_PUBLIC_VAPID_PUBLIC_KEY is
 * provisioned). Until that env var is set, background push delivery
 * degrades gracefully — in-session SSE events still render here.
 *
 * owner-settings-4: push token registration is wired in
 * ServiceWorkerRegister.tsx once VAPID env is provisioned; see
 * needsAttention in the agent-B manifest for the sw.js push listener.
 */
export default async function NotificationsPage() {
  const locale = await readLocaleFromServerCookies();

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-foreground">
          {pickByLocale(locale, { en: 'Notifications', sw: 'Arifa' })}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-neutral-300">
          {pickByLocale(locale, {
            en: 'Live activity from your sites — decisions, reminders, manager escalations, RFB dispatches, payroll commits, regulator requests.',
            sw: 'Shughuli za moja kwa moja kutoka kwa maeneo yako — maamuzi, vikumbusho, upandishaji wa meneja, uwasilishaji wa RFB, ahadi za malipo, maombi ya mdhibiti.',
          })}
        </p>
      </header>
      <NotificationsInbox />
    </div>
  );
}
