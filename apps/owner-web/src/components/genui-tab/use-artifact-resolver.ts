'use client';

/**
 * useArtifactResolver — closure Wave 8, the brain-proposal → artifact-render
 * seam (resolver half).
 *
 * The owner-web SSE parser (`tab-sse-parser.ts`) recognises a modality
 * ARTIFACT proposal (forecast / document / media) and forwards the artifact
 * IDENTITY (proposalId + kind) up to the shell. This hook turns that identity
 * into something renderable: it fetches the EGRESS-MEMBRANE-PROJECTED
 * descriptor from `GET /api/v1/modality-artifacts/:proposalId` — the
 * allow-listed, mechanic-key-scrubbed shape the gateway projects (OK-8a) —
 * with an HONEST loading state, then hands the typed descriptor to the shell
 * which routes it to the matching renderer:
 *
 *   - document / media  → <ArtifactRenderer> (rich chrome, DOMPurify-wrapped)
 *   - forecast          → the genui preview tab (chart / table genui blocks)
 *
 * It NEVER fetches the un-projected blob — only the projected route. The
 * projected `tab` rides along so the forecast path can hydrate the genui
 * preview without a second round-trip.
 *
 * Degrade-safe: a fetch / parse failure resolves to `status:'error'` (the
 * shell shows a non-blocking inline notice — never a crash). LIVE-only, no
 * mock fallback — matches `use-genui-tab.ts`.
 */

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { safeParsePortalTab, type PortalTab } from '@borjie/portal-genui';

import { apiRequest, ApiError, localizeError } from '@/lib/api-client';
import { localizeApiError } from '@borjie/error-catalog';
import { useLocale } from '@/lib/locale';

/** The artifact modalities a projected descriptor can carry. */
export const ARTIFACT_DESCRIPTOR_KINDS = [
  'forecast',
  'document',
  'media',
] as const;
export type ArtifactDescriptorKind = (typeof ARTIFACT_DESCRIPTOR_KINDS)[number];

/**
 * The membrane-projected descriptor returned by the gateway. The `artifact`
 * blob is opaque renderable content (already scrubbed of mechanic keys by the
 * egress membrane) — we keep it loose (record) and let the renderer read the
 * fields it understands. `tab` is the genui preview spec (re-validated with
 * `safeParsePortalTab`).
 */
const projectedArtifactSchema = z.object({
  proposalId: z.string().min(1),
  artifactKind: z.enum(ARTIFACT_DESCRIPTOR_KINDS).nullable(),
  posture: z.string().nullable().optional(),
  reversible: z.boolean().optional(),
  accepted: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  tab: z.unknown().optional(),
  artifact: z.record(z.string(), z.unknown()).nullable().optional(),
  evidenceIds: z.array(z.string()).default([]),
  confidence: z.number().nullable().optional(),
});

/** The typed descriptor the shell routes to a renderer. */
export interface ResolvedArtifact {
  readonly proposalId: string;
  readonly artifactKind: ArtifactDescriptorKind;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number | null;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  /** The opaque, membrane-scrubbed renderable content. */
  readonly artifact: Readonly<Record<string, unknown>>;
  /** The genui preview tab (re-validated) — drives the forecast/table path. */
  readonly tab: PortalTab | null;
}

export type ArtifactResolveState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly artifact: ResolvedArtifact }
  | { readonly status: 'error'; readonly message: string };

/**
 * Resolve a modality artifact proposal by id. Pass `null` to stay idle (the
 * hook is called unconditionally to satisfy rules-of-hooks).
 */
export function useArtifactResolver(
  proposalId: string | null | undefined,
): ArtifactResolveState {
  const [state, setState] = useState<ArtifactResolveState>(
    proposalId ? { status: 'loading' } : { status: 'idle' },
  );
  // Active locale — the error message is localized by the gateway's stable
  // CODE (the raw English `.message` would be language MIXING under `sw`).
  const locale = useLocale();
  const activeId = useRef<string | null>(proposalId ?? null);

  useEffect(() => {
    activeId.current = proposalId ?? null;
    if (!proposalId) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    const controller = new AbortController();

    (async () => {
      try {
        const raw = await apiRequest<unknown>(
          `/api/v1/modality-artifacts/${encodeURIComponent(proposalId)}`,
          { signal: controller.signal },
        );
        if (activeId.current !== proposalId) return;
        const parsed = projectedArtifactSchema.safeParse(raw);
        const artifactKind = parsed.success ? parsed.data.artifactKind : null;
        if (!parsed.success || !artifactKind) {
          setState({
            status: 'error',
            // Localize by code — a raw English body under a localized prefix is
            // MIXING under sw. Unknown code → localized generic fallback.
            message: localizeApiError('ARTIFACT_MALFORMED', locale),
          });
          return;
        }
        const d = parsed.data;
        setState({
          status: 'ready',
          artifact: {
            proposalId: d.proposalId,
            artifactKind,
            evidenceIds: d.evidenceIds,
            confidence: d.confidence ?? null,
            accepted: d.accepted ?? false,
            dismissed: d.dismissed ?? false,
            artifact: d.artifact ?? {},
            tab: d.tab ? safeParsePortalTab(d.tab) : null,
          },
        });
      } catch (err) {
        if (activeId.current !== proposalId) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({
            status: 'error',
            message: localizeApiError('NOT_FOUND', locale),
          });
          return;
        }
        setState({ status: 'error', message: localizeError(err, locale) });
      }
    })();

    return () => controller.abort();
  }, [proposalId, locale]);

  return state;
}
