import type { ReactNode } from 'react';

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
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-neutral-400">
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
  if (errorMessage) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {isSw
            ? 'Taarifa ya asubuhi haipatikani kwa sasa.'
            : 'The morning briefing is unavailable right now.'}
        </p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-neutral-400">
          {isSw ? 'Hakuna taarifa.' : 'No briefing content.'}
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
          title={isSw ? 'Shughuli za usiku' : 'Overnight activity'}
          count={overnight?.totalAutonomousActions}
        >
          {(overnight?.notableActions ?? []).length === 0 ? (
            <p className="text-xs text-neutral-500">
              {isSw ? 'Hakuna shughuli za kujiendesha.' : 'No autonomous actions.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {(overnight?.notableActions ?? []).map((a, i) => (
                <li key={i} className="text-xs text-neutral-300">
                  {a.summary}
                  {a.domain ? (
                    <span className="ml-2 text-neutral-500">· {a.domain}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={isSw ? 'Idhini zinazosubiri' : 'Pending approvals'}
          count={pending?.count}
        >
          {(pending?.items ?? []).length === 0 ? (
            <p className="text-xs text-neutral-500">
              {isSw ? 'Hakuna kinachosubiri.' : 'Nothing awaiting a decision.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {(pending?.items ?? []).map((it, i) => (
                <li key={i} className="text-xs text-neutral-300">
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
          title={isSw ? 'Masuala yaliyopandishwa' : 'Escalations'}
          count={escalations?.count}
        >
          {(escalations?.items ?? []).length === 0 ? (
            <p className="text-xs text-neutral-500">
              {isSw ? 'Hakuna masuala.' : 'No escalations.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {(escalations?.items ?? []).map((it, i) => (
                <li key={i} className="text-xs text-neutral-300">
                  {it.priority ? (
                    <span className="mr-2 text-destructive">{it.priority}</span>
                  ) : null}
                  {it.summary}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={isSw ? 'Mapendekezo' : 'Recommendations'} count={recs.length}>
          {recs.length === 0 ? (
            <p className="text-xs text-neutral-500">
              {isSw ? 'Hakuna mapendekezo.' : 'No recommendations.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {recs.map((r, i) => (
                <li key={i} className="text-xs text-neutral-300">
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
        <Card title={isSw ? 'Mambo yasiyo ya kawaida' : 'Anomalies'} count={anomalies.length}>
          <ul className="space-y-2">
            {anomalies.map((a, i) => (
              <li key={i} className="text-xs text-neutral-300">
                <span className="text-foreground">{a.area}</span> — {a.observation}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
