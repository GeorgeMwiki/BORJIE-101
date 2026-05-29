import { Suspense } from 'react';
import { OAuthConfirmPanel } from './confirm-panel';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Idhinisha wakala — Borjie',
};

/**
 * /oauth/confirm — OAuth2 Device-Flow consent landing.
 *
 * Read by /api/v1/oauth/device/verify (302 redirect) or pasted by the
 * owner directly from the device. The page fetches the requested
 * scopes via GET /api/v1/oauth/device/details?code=USER_CODE and shows
 * an Approve / Deny choice in bilingual Swahili-English.
 */
export default function OAuthConfirmPage() {
  return (
    <main
      className="relative min-h-screen overflow-hidden bg-background p-6"
      id="main-content"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--signal-500) / 0.12) 0%, transparent 60%)',
        }}
      />
      <div className="relative flex min-h-shell items-center justify-center">
        <Suspense
          fallback={
            <div className="text-sm text-neutral-500">Inapakia…</div>
          }
        >
          <OAuthConfirmPanel />
        </Suspense>
      </div>
    </main>
  );
}
