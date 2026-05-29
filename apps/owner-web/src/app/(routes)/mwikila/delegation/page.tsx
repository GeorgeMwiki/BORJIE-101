/**
 * Mr. Mwikila delegation matrix — owner-web page.
 *
 * The 12 × 4 matrix where the owner sets the per-category autonomy
 * tier (T0 inform / T1 propose / T2 act-with-reversal / T3
 * irrevocable).
 *
 * Routes used:
 *   GET   /api/v1/owner/delegation
 *   PATCH /api/v1/owner/delegation
 */

import { DelegationMatrix } from './delegation-matrix';

export const dynamic = 'force-dynamic';

export default function MwikilaDelegationPage() {
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          Mwikila delegation
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Uwakilishi wa Mwikila — chagua kiwango cha uhuru kwa kila kazi
        </p>
        <p className="mt-3 max-w-2xl text-sm text-neutral-300">
          Set per-category delegation. T0 informs only, T1 drafts and
          waits for your one-tap approval, T2 acts immediately with a
          24-hour reversal window, T3 acts irrevocably (use sparingly).
        </p>
      </header>
      <DelegationMatrix />
    </main>
  );
}
