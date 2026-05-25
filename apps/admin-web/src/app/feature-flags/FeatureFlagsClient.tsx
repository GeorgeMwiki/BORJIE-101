'use client';

/**
 * Feature flags admin — migrated from
 * apps/admin-portal/src/pages/FeatureFlags.tsx.
 *
 *   GET /api/v1/feature-flags        — resolved list for the caller scope
 *   PUT /api/v1/feature-flags/:key   — toggle a single flag
 */

import { useCallback, useEffect, useState } from 'react';
import { Flag, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface FeatureFlag {
  readonly key: string;
  readonly name?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly scope?: string;
  readonly updatedAt?: string;
}

export function FeatureFlagsClient() {
  const [flags, setFlags] = useState<readonly FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.get<readonly FeatureFlag[]>('/feature-flags');
    if (res.success && res.data) {
      setFlags(res.data);
    } else {
      setError(res.error ?? 'Failed to load flags');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: FeatureFlag): Promise<void> {
    setSaving(flag.key);
    const next = { ...flag, enabled: !flag.enabled };
    const res = await api.put(
      `/feature-flags/${encodeURIComponent(flag.key)}`,
      { enabled: next.enabled },
    );
    setSaving(null);
    if (res.success) {
      setFlags((prev) =>
        prev.map((f) =>
          f.key === flag.key ? { ...f, enabled: next.enabled } : f,
        ),
      );
    } else {
      setError(res.error ?? 'Failed to update flag');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Flag className="h-6 w-6 text-indigo-400" />
        <p className="text-sm text-neutral-400">
          Server-resolved flags. Toggling here only affects the caller&apos;s
          scope.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && flags.length === 0 && !error && (
        <div className="platform-card text-sm text-neutral-400">
          No flags resolved for this caller.
        </div>
      )}

      {!loading && flags.length > 0 && (
        <section className="platform-card overflow-hidden">
          <ul className="divide-y divide-border/40">
            {flags.map((flag) => (
              <li key={flag.key} className="flex items-start gap-4 py-4">
                <div className="mt-1">
                  {flag.enabled ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-neutral-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {flag.name ?? flag.key}
                    </p>
                    <code className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-neutral-400">
                      {flag.key}
                    </code>
                    {flag.scope && (
                      <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300">
                        {flag.scope}
                      </span>
                    )}
                  </div>
                  {flag.description && (
                    <p className="mt-1 text-sm text-neutral-400">
                      {flag.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(flag)}
                  disabled={saving === flag.key}
                  aria-pressed={flag.enabled}
                  aria-label={`Toggle ${flag.key}`}
                  data-testid={`flag-${flag.key}`}
                  className={`flex h-6 w-12 items-center rounded-full p-1 transition ${
                    flag.enabled ? 'bg-emerald-500' : 'bg-neutral-700'
                  } ${saving === flag.key ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`h-4 w-4 transform rounded-full bg-white shadow transition ${
                      flag.enabled ? 'translate-x-6' : ''
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
