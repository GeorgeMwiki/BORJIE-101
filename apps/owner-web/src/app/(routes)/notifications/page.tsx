import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';

/**
 * Owner-web — notifications inbox (parity with workforce-mobile +
 * buyer-mobile). Shows the live SSE event stream the owner cockpit
 * has consumed during the current session.
 *
 * Out-of-app delivery (when the tab is closed) goes through web push;
 * the token registration backend is the same `/me/device-tokens`
 * endpoint the mobile apps hit.
 */
export default function NotificationsPage() {
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-foreground">Notifications</h1>
        <p className="mt-1 text-sm italic text-neutral-500">Arifa</p>
        <p className="mt-3 max-w-3xl text-sm text-neutral-300">
          Live activity from your sites — decisions, reminders, manager
          escalations, RFB dispatches, payroll commits, regulator
          requests. Background delivery goes through web push and is
          stored here for replay.
        </p>
      </header>
      <NotificationsInbox />
    </div>
  );
}
