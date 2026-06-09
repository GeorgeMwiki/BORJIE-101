'use client';

/**
 * GenUI-tab RECORD query hooks — the data plane that turns a generated
 * `PortalTab` from an inert preview into a working mini-app.
 *
 * Backing contract (owned by K1a, mounted on the gateway):
 *   GET  /api/v1/portal-genui/tabs/:id/records
 *        → { records: [{ id, payload, createdAt }] }
 *   POST /api/v1/portal-genui/tabs/:id/records
 *        body { payload: Record<string,unknown> } → { id }
 *
 * Everything here is GENERATIVE — driven by the tab id alone, never a
 * per-tab branch. The `payload` is the field-keyed value bag the form-host
 * collects ({ "<sectionKey>.<fieldKey>": value }); the gateway validates it
 * against the persisted tab schema + RLS-scopes the write to the tenant, so
 * the client keeps the payload loose (`Record<string, unknown>`) and lets the
 * server be the source of truth.
 *
 * LIVE-only (matches `api-client.ts`): no mock fallback. Failures land on the
 * react-query `error` channel so the host renders an honest empty/error state.
 * Mutations are NOT retried (the QueryClient default) so a half-applied write
 * is never silently re-sent.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from '@/lib/api-client';

/** Query-key factory — one namespace per tab so writes invalidate precisely. */
export const genuiRecordKeys = {
  all: ['genui-records'] as const,
  list: (tabId: string) => ['genui-records', tabId] as const,
};

/**
 * One persisted record. `payload` is the field-keyed value bag; we keep it
 * loose (the tab schema defines the keys, validated server-side) and let the
 * widget renderers read the columns they understand.
 */
const GenuiRecordSchema = z.object({
  id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().default(''),
});

export type GenuiRecord = z.infer<typeof GenuiRecordSchema>;

const RecordsResponseSchema = z.object({
  records: z.array(GenuiRecordSchema).default([]),
});

const CreateRecordResponseSchema = z.object({
  id: z.string().min(1),
});

export type GenuiRecordPayload = Readonly<Record<string, unknown>>;

/**
 * Fetch the persisted records for a generated tab. Pass `null`/`undefined`
 * (or `enabled:false` upstream) to stay idle — the query is disabled when no
 * tab id is supplied so the host can call it unconditionally (rules-of-hooks).
 */
export function useGenuiRecords(tabId: string | null | undefined) {
  return useQuery({
    queryKey: genuiRecordKeys.list(tabId ?? '∅'),
    enabled: Boolean(tabId),
    queryFn: async ({ signal }): Promise<ReadonlyArray<GenuiRecord>> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/portal-genui/tabs/${encodeURIComponent(tabId!)}/records`,
        { signal },
      );
      const parsed = RecordsResponseSchema.safeParse(raw);
      // A wire-format drift surfaces as an empty list, never a render crash.
      return parsed.success ? parsed.data.records : [];
    },
    staleTime: 15_000,
  });
}

/**
 * Persist a new record for a generated tab. On success the tab's record list
 * is invalidated so freshly-submitted rows flow into the live widgets.
 */
export function useCreateGenuiRecord(tabId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GenuiRecordPayload): Promise<{ id: string }> => {
      if (!tabId) {
        throw new Error('tab id is required to persist a record');
      }
      const raw = await apiRequest<unknown>(
        `/api/v1/portal-genui/tabs/${encodeURIComponent(tabId)}/records`,
        { method: 'POST', body: { payload } },
      );
      const parsed = CreateRecordResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('record create returned an unexpected shape');
      }
      return parsed.data;
    },
    onSuccess: () => {
      if (tabId) {
        void queryClient.invalidateQueries({
          queryKey: genuiRecordKeys.list(tabId),
        });
      }
    },
  });
}
