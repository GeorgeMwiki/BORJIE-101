'use client';

/**
 * Feature flags admin — migrated from
 * apps/admin-portal/src/pages/FeatureFlags.tsx.
 *
 *   GET /api/v1/feature-flags        — resolved list for the caller scope
 *   PUT /api/v1/feature-flags/:key   — toggle a single flag
 *
 * Rendered on design-system primitives + semantic tokens. The toggle is a
 * keyboard-operable button with `aria-pressed` (there is no DS Switch).
 * SINGLE LANGUAGE PER LOCALE (canon): every user-facing string resolves to
 * the active locale via `pickByLocale`. Purely client surface — the hook
 * falls back to the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Flag, CheckCircle2, XCircle } from 'lucide-react';
import { Card, Skeleton, Alert, Empty, Badge } from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

interface FeatureFlag {
  readonly key: string;
  readonly name?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly scope?: string;
  readonly updatedAt?: string;
}

const S = {
  intro: {
    en: "Server-resolved flags. Toggling here only affects the caller's scope.",
    sw: 'Bendera zilizotatuliwa na seva. Kubadilisha hapa kunaathiri wigo wa mwitaji pekee.',
  },
  loadFailed: { en: 'Failed to load flags', sw: 'Imeshindwa kupakia bendera' },
  updateFailed: { en: 'Failed to update flag', sw: 'Imeshindwa kusasisha bendera' },
  emptyTitle: {
    en: 'No flags resolved for this caller',
    sw: 'Hakuna bendera zilizotatuliwa kwa mwitaji huyu',
  },
  emptyBody: {
    en: 'Flags become visible here once they are defined for the caller scope.',
    sw: 'Bendera zinakuwa wazi hapa mara zinapofafanuliwa kwa wigo wa mwitaji.',
  },
  toggle: { en: 'Toggle', sw: 'Badilisha' },
} as const;

export function FeatureFlagsClient() {
  const locale = useLocale();
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
      setError(res.error ?? pickByLocale(locale, S.loadFailed));
    }
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: FeatureFlag): Promise<void> {
    setSaving(flag.key);
    const next = { ...flag, enabled: !flag.enabled };
    const res = await api.put(`/feature-flags/${encodeURIComponent(flag.key)}`, {
      enabled: next.enabled,
    });
    setSaving(null);
    if (res.success) {
      setFlags((prev) =>
        prev.map((f) =>
          f.key === flag.key ? { ...f, enabled: next.enabled } : f,
        ),
      );
    } else {
      setError(res.error ?? pickByLocale(locale, S.updateFailed));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Flag className="h-6 w-6 text-info" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      )}

      {!loading && flags.length === 0 && !error && (
        <Empty
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      )}

      {!loading && flags.length > 0 && (
        <Card className="overflow-hidden rounded-2xl p-6 transition-colors hover:border-border-strong">
          <ul className="divide-y divide-border/40">
            {flags.map((flag) => (
              <li key={flag.key} className="flex items-start gap-4 py-4">
                <div className="mt-1">
                  {flag.enabled ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {flag.name ?? flag.key}
                    </p>
                    <code className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-muted-foreground">
                      {flag.key}
                    </code>
                    {flag.scope && (
                      <Badge variant="info-soft" size="sm">
                        {flag.scope}
                      </Badge>
                    )}
                  </div>
                  {flag.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {flag.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(flag)}
                  disabled={saving === flag.key}
                  aria-pressed={flag.enabled}
                  aria-label={`${pickByLocale(locale, S.toggle)} ${flag.key}`}
                  data-testid={`flag-${flag.key}`}
                  className={`flex h-6 w-12 items-center rounded-full p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    flag.enabled ? 'bg-success' : 'bg-muted'
                  } ${saving === flag.key ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`h-4 w-4 transform rounded-full bg-background shadow transition ${
                      flag.enabled ? 'translate-x-6' : ''
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
