'use client';

/**
 * Detail panel for the per-person memory cells page.
 *
 * GET /api/v1/me/persons/:personId/cells returns:
 *   - 200 { success, data: MemoryCell[] }
 *   - 403 { success: false, error: { code: 'CONSENT_REQUIRED' | 'FORBIDDEN_PERSON' } }
 *   - 503 { success: false, error: { code: 'DATABASE_UNAVAILABLE' } }
 *
 * The 403 CONSENT_REQUIRED branch shows a bilingual banner directing
 * the user to the Settings → Share consent screen instead of the
 * memory-cell list. The 403 FORBIDDEN_PERSON branch shows a security
 * notice.
 */

import { useCallback, useEffect, useState } from 'react';

interface MemoryCell {
  readonly id: string;
  readonly personId: string;
  readonly cellKind: string;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly sourceTenantId: string | null;
  readonly capturedAt: string;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; cells: ReadonlyArray<MemoryCell> }
  | { kind: 'consent-required' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

const KIND_LABEL_SW: Record<string, string> = {
  preference: 'Mapendekezo',
  context: 'Mazingira ya sasa',
  'recurring-fact': 'Ukweli wa maisha',
  calibration: 'Marekebisho',
  sentiment: 'Hisia za hivi karibuni',
};

export function PersonalKbDetailPanel({
  personId,
}: {
  readonly personId: string;
}) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/v1/me/persons/${personId}/cells`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        const json = (await res.json()) as {
          error?: { code?: string };
        };
        if (json.error?.code === 'CONSENT_REQUIRED') {
          setState({ kind: 'consent-required' });
        } else {
          setState({ kind: 'forbidden' });
        }
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<MemoryCell>;
      };
      setState({ kind: 'ok', cells: json.data ?? [] });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <p className="mt-6 text-sm text-neutral-400">Loading… / Inapakia…</p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="mt-6 text-sm text-destructive">
        Error: {state.message}
      </p>
    );
  }
  if (state.kind === 'forbidden') {
    return (
      <p className="mt-6 text-sm text-destructive">
        You can only read your own personal-KB. /
        Unaweza tu kusoma maktaba yako mwenyewe.
      </p>
    );
  }
  if (state.kind === 'consent-required') {
    return (
      <div className="mt-6 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
        <h2 className="font-display text-xl text-foreground">
          Consent required
        </h2>
        <p className="text-xs italic text-amber-200">Idhini inahitajika</p>
        <p className="mt-3 text-sm text-neutral-200">
          To read your personal memory cells we need your affirmative
          consent. Open <strong>Settings → Share consent</strong> to opt in.
        </p>
        <p className="mt-2 text-sm text-neutral-300">
          Ili kusoma kumbukumbu zako za kibinafsi tunahitaji idhini yako.
          Fungua <strong>Mipangilio → Idhini</strong> kuruhusu.
        </p>
      </div>
    );
  }

  const cells = state.cells;
  if (cells.length === 0) {
    return (
      <p className="mt-6 text-sm text-neutral-400">
        No cells yet. / Hakuna kumbukumbu bado.
      </p>
    );
  }

  // Group by cellKind for visual structure.
  const grouped = cells.reduce<Record<string, MemoryCell[]>>(
    (acc, cell) => {
      const list = acc[cell.cellKind] ?? [];
      list.push(cell);
      acc[cell.cellKind] = list;
      return acc;
    },
    {},
  );

  return (
    <section className="mt-6 space-y-6">
      {Object.entries(grouped).map(([kind, group]) => (
        <div
          key={kind}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="font-display text-xl text-foreground">
            {KIND_LABEL_SW[kind] ?? kind}
            <span className="ml-2 text-xs text-neutral-500">({group.length})</span>
          </h2>
          <ul className="mt-3 space-y-2">
            {group.map((cell) => (
              <li
                key={cell.id}
                className="rounded border border-border bg-background p-3"
              >
                <p className="font-medium text-foreground">{cell.key}</p>
                <p className="mt-1 text-sm text-neutral-300">
                  {typeof cell.value === 'string'
                    ? cell.value
                    : JSON.stringify(cell.value)}
                </p>
                <p className="mt-1 text-xxs text-neutral-500">
                  captured {new Date(cell.capturedAt).toLocaleString()} ·
                  confidence {cell.confidence}
                  {cell.sourceTenantId ? (
                    <> · from tenant {cell.sourceTenantId.slice(0, 8)}…</>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
