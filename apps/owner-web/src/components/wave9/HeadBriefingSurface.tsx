import { useMemo, type ReactNode } from 'react';
import { dictionaries } from '@/i18n/dictionaries';
import { makeT } from '@/i18n/resolve';

/**
 * Minimal projection of the gateway BriefingDocument the surface renders.
 * Mirrors `@borjie/ai-copilot/head-briefing` BriefingDocument; widened to
 * optional so a partial / degraded payload still renders honestly.
 */
export interface BriefingDoc {
  readonly headline?: string;
  readonly generatedAt?: string;
  readonly overnight?: {
    readonly totalAutonomousActions?: number;
    readonly notableActions?: ReadonlyArray<{
      readonly summary: string;
      readonly domain?: string;
      readonly confidence?: number;
    }>;
  };
  readonly pendingApprovals?: {
    readonly count?: number;
    readonly items?: ReadonlyArray<{
      readonly summary: string;
      readonly urgency?: string;
    }>;
  };
  readonly escalations?: {
    readonly count?: number;
    readonly items?: ReadonlyArray<{
      readonly summary: string;
      readonly priority?: string;
    }>;
  };
  readonly recommendations?: ReadonlyArray<{
    readonly topic: string;
    readonly summary: string;
    readonly suggestedAction?: string;
  }>;
  readonly anomalies?: ReadonlyArray<{
    readonly area: string;
    readonly observation: string;
  }>;
}

interface HeadBriefingSurfaceProps {
  readonly doc: BriefingDoc | null;
  readonly errorMessage: string | null;
  readonly isSw: boolean;
}

function Card({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Head briefing surface (O-W-32, read-only).
 *
 * Renders the curated first-login document from the gateway head-briefing
 * composer. Degrades to an honest "unavailable" panel when the composer is
 * not wired or the upstream read fails — never fabricates a briefing.
 */
export function HeadBriefingSurface({
  doc,
  errorMessage,
  isSw,
}: HeadBriefingSurfaceProps): JSX.Element {
  const t = useMemo(
    () => makeT(dictionaries[isSw ? 'sw' : 'en']),
    [isSw],
  );
  if (errorMessage) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('headBriefing.unavailable')}
        </p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t('headBriefing.noContent')}
        </p>
      </div>
    );
  }

  const overnight = doc.overnight;
  const pending = doc.pendingApprovals;
  const escalations = doc.escalations;
  const recs = doc.recommendations ?? [];
  const anomalies = doc.anomalies ?? [];

  return (
    <div className="space-y-6">
      {doc.headline ? (
        <p className="text-base text-foreground">{doc.headline}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title={t('headBriefing.overnightActivity')}
          count={overnight?.totalAutonomousActions}
        >
          {(overnight?.notableActions ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('headBriefing.noAutonomousActions')}
            </p>
          ) : (
            <ul className="space-y-2">
              {(overnight?.notableActions ?? []).map((a, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  {a.summary}
                  {a.domain ? (
                    <span className="ml-2 text-muted-foreground">· {a.domain}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('headBriefing.pendingApprovals')}
          count={pending?.count}
        >
          {(pending?.items ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('headBriefing.nothingAwaiting')}
            </p>
          ) : (
            <ul className="space-y-2">
              {(pending?.items ?? []).map((it, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  {it.summary}
                  {it.urgency ? (
                    <span className="ml-2 text-warning">· {it.urgency}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('headBriefing.escalations')}
          count={escalations?.count}
        >
          {(escalations?.items ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('headBriefing.noEscalations')}
            </p>
          ) : (
            <ul className="space-y-2">
              {(escalations?.items ?? []).map((it, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  {it.priority ? (
                    <span className="mr-2 text-destructive">{it.priority}</span>
                  ) : null}
                  {it.summary}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('headBriefing.recommendations')} count={recs.length}>
          {recs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('headBriefing.noRecommendations')}
            </p>
          ) : (
            <ul className="space-y-2">
              {recs.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{r.topic}</span> — {r.summary}
                  {r.suggestedAction ? (
                    <span className="ml-1 text-signal-500">→ {r.suggestedAction}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {anomalies.length > 0 ? (
        <Card title={t('headBriefing.anomalies')} count={anomalies.length}>
          <ul className="space-y-2">
            {anomalies.map((a, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                <span className="text-foreground">{a.area}</span> — {a.observation}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
