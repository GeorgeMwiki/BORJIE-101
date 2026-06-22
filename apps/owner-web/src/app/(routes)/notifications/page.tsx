import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { notificationsPageStrings as S } from '@/i18n/strings/notifications-page';

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
          {pickByLocale(locale, S.title)}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {pickByLocale(locale, S.subtitle)}
        </p>
      </header>
      <NotificationsInbox />
    </div>
  );
}
