'use client';

/**
 * Discord-style left-rail tenant switcher — Roadmap R12.
 *
 * Lists every tenant the user is linked to (cross-tenant federation
 * per Docs/research/unified-personal-kb.md §10). Click an avatar to
 * switch — the api-gateway writes a `borjie-active-tenant` HttpOnly
 * cookie and the next request re-binds RLS to that tenant.
 *
 * Renders nothing when the user is linked to just one tenant
 * (rail would be visual noise in that case).
 */

import { useCallback, useEffect, useState } from 'react';

import { getCsrfHeaders } from '@/lib/csrf';

interface TenantMembership {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly logoUrl: string | null;
  readonly roleInTenant: string;
  readonly active: boolean;
}

const ROLE_TONE: Record<string, string> = {
  owner: 'bg-gold/20 text-gold',
  manager: 'bg-blue-500/20 text-blue-300',
  employee: 'bg-emerald-500/20 text-emerald-300',
  buyer: 'bg-purple-500/20 text-purple-300',
  admin: 'bg-rose-500/20 text-rose-300',
};

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
}

export function TenantRail() {
  const [items, setItems] = useState<ReadonlyArray<TenantMembership>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/me/tenants', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<TenantMembership>;
      };
      setItems(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = useCallback(
    async (tenantId: string) => {
      setSwitching(tenantId);
      try {
        const res = await fetch('/api/v1/me/tenants/active', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
          body: JSON.stringify({ tenantId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Force a hard reload so the auth context picks up the new
        // active tenant on every component.
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSwitching(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <aside
        aria-label="Tenant rail"
        className="flex w-16 flex-col items-center gap-2 border-r border-border bg-surface py-3"
      >
        <span className="text-xxs text-neutral-500">…</span>
      </aside>
    );
  }

  if (error) {
    return (
      <aside
        aria-label="Tenant rail (error)"
        className="flex w-16 flex-col items-center gap-2 border-r border-border bg-surface py-3"
        title={`Failed to load tenants: ${error}`}
      >
        <span className="text-xxs text-destructive">!</span>
      </aside>
    );
  }

  if (items.length <= 1) {
    // Hide the rail entirely when there's nothing to switch to.
    return null;
  }

  return (
    <aside
      aria-label="Tenant rail"
      className="flex w-16 flex-col items-center gap-2 border-r border-border bg-surface py-3"
    >
      {items.map((item) => (
        <button
          key={item.tenantId}
          type="button"
          onClick={() => void switchTo(item.tenantId)}
          disabled={switching === item.tenantId || item.active}
          aria-label={`Switch to ${item.tenantName} as ${item.roleInTenant}`}
          title={`${item.tenantName} · ${item.roleInTenant}`}
          className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border transition-all ${
            item.active
              ? 'border-gold bg-gold/10'
              : 'border-border bg-background hover:rounded-xl hover:border-foreground'
          } disabled:cursor-default`}
        >
          {item.logoUrl ? (
            // Standalone <img> is intentional here — the avatar is small
            // (40px), the URL is user-supplied (no Next/Image loader allowlist),
            // and we want zero LCP/CLS impact on the rail. The
            // `@next/next/no-img-element` rule is intentionally NOT enabled
            // in this app's flat-config — see apps/owner-web/eslint.config.mjs.
            <img
              src={item.logoUrl}
              alt=""
              className="h-10 w-10 rounded-xl object-cover"
            />
          ) : (
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold ${
                ROLE_TONE[item.roleInTenant] ?? 'bg-neutral-700 text-neutral-200'
              }`}
            >
              {initials(item.tenantName)}
            </span>
          )}
          {item.active ? (
            <span
              aria-hidden
              className="absolute -left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-gold"
            />
          ) : null}
        </button>
      ))}
    </aside>
  );
}
