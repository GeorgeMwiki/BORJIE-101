import { cookies } from 'next/headers';
import { Sparkles, ShieldAlert } from 'lucide-react';

import { PLATFORM_SESSION_COOKIE } from '@/lib/session';

/**
 * PrivacyBudgetCard — right-pane budget readout for /ask.
 *
 * Every query to the industry observer costs privacy budget; this card
 * is the differentiator between the HQ surface and the tenant surface.
 *
 * Never renders a mock number. If the DP-accountant is not reachable,
 * the card honestly says so.
 */

interface BudgetPayload {
  readonly remainingEpsilon?: number;
  readonly totalEpsilon?: number;
  readonly windowLabel?: string;
  readonly costPerQueryEpsilon?: number;
}

type BudgetResult =
  | { readonly status: 'ok'; readonly data: BudgetPayload }
  | { readonly status: 'offline'; readonly reason: string };

async function fetchBudget(cookieHeader: string): Promise<BudgetResult> {
  try {
    const base =
      process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ?? 'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/budget`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'offline',
        reason: 'DP-accountant offline. No ε shown — rendering would be a lie.',
      };
    }
    if (!res.ok) {
      return {
        status: 'offline',
        reason: `Upstream returned ${res.status}. Budget unavailable.`,
      };
    }
    const data = (await res.json()) as BudgetPayload;
    if (typeof data.remainingEpsilon !== 'number') {
      return {
        status: 'offline',
        reason: 'DP-accountant did not return a numeric ε. Refusing to render.',
      };
    }
    return { status: 'ok', data };
  } catch (error) {
    console.error('PrivacyBudgetCard fetch failed:', error);
    return {
      status: 'offline',
      reason: 'Network error reaching the DP-accountant.',
    };
  }
}

export async function PrivacyBudgetCard() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const result = sessionPresent
    ? await fetchBudget(cookieHeader)
    : ({ status: 'offline', reason: 'No staff session cookie present.' } as const);

  if (result.status === 'offline') {
    return (
      <div className="rounded-lg border border-border bg-surface-sunken p-5">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Privacy budget
          </span>
        </div>
        <div className="text-sm text-warning mb-1">Budget service offline</div>
        <p className="text-xs text-neutral-500 leading-relaxed">{result.reason}</p>
      </div>
    );
  }

  const { remainingEpsilon, totalEpsilon, windowLabel, costPerQueryEpsilon } =
    result.data;
  const pct =
    typeof totalEpsilon === 'number' && totalEpsilon > 0
      ? Math.max(0, Math.min(1, (remainingEpsilon ?? 0) / totalEpsilon))
      : null;

  return (
    <div className="rounded-lg border border-signal-500/20 bg-surface-sunken p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-signal-500" />
        <span className="text-xs uppercase tracking-wider text-neutral-500">
          Privacy budget
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-display text-3xl text-signal-500">
          {(remainingEpsilon ?? 0).toFixed(2)}
        </span>
        <span className="text-xs text-neutral-500">ε remaining</span>
      </div>

      {typeof totalEpsilon === 'number' ? (
        <div className="text-xs text-neutral-500 mb-3">
          of {totalEpsilon.toFixed(2)} ε total
          {windowLabel ? ` · ${windowLabel}` : ''}
        </div>
      ) : null}

      {pct !== null ? (
        <div className="h-1 rounded-full bg-border overflow-hidden mb-3">
          <div
            className="h-full bg-signal-500"
            style={{ width: `${(pct * 100).toFixed(1)}%` }}
          />
        </div>
      ) : null}

      {typeof costPerQueryEpsilon === 'number' ? (
        <p className="text-xs text-neutral-500 leading-relaxed">
          Each query against the observer costs{' '}
          <span className="text-foreground">
            {costPerQueryEpsilon.toFixed(3)} ε
          </span>
          . When the balance hits zero, the surface closes until the next window.
        </p>
      ) : (
        <p className="text-xs text-neutral-500 leading-relaxed">
          Each query costs privacy budget. When the balance hits zero, the
          surface closes until the next window.
        </p>
      )}
    </div>
  );
}
