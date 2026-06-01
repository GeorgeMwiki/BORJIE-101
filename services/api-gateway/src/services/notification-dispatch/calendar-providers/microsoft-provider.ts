/**
 * Microsoft 365 (Graph) calendar event provider.
 *
 * Graph does NOT allow client-specified event ids, so idempotency is keyed on a
 * custom `singleValueExtendedProperty` (`borjieSourceId`) stamped on every
 * event we create:
 *
 *   1. GET  /me/events?$filter=singleValueExtendedProperties/any(
 *             ep: ep/id eq '<propId>' and ep/value eq '<sourceId>')
 *        - a hit → PATCH /me/events/{id}   → 'updated'
 *        - no hit → POST /me/events        → 'created'
 *
 * The POST also carries a `transactionId` (= sourceId) which Graph treats as an
 * idempotency token for ~ the duration of a few minutes, defending the
 * narrow create→retry race even before the extended-property query is visible.
 *
 * API: https://learn.microsoft.com/graph/api/user-post-events
 *      https://learn.microsoft.com/graph/api/event-update
 *      https://learn.microsoft.com/graph/extended-properties-overview
 */

import type {
  CalendarEventInput,
  CalendarEventProvider,
  CalendarFetcher,
  CalendarProviderDeps,
  CalendarUpsertResult,
} from './types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Named property bag + key for our idempotency stamp. The GUID namespace is a
 * fixed Borjie constant so the property id is identical across processes.
 */
const EXT_PROP_ID =
  'String {b6e6f3a0-1c2d-4e5f-9a8b-0c1d2e3f4a5b} Name borjieSourceId';

function endIsoFor(input: CalendarEventInput): string {
  if (input.endIso) return input.endIso;
  const start = Date.parse(input.startIso);
  const end = Number.isFinite(start) ? start + 30 * 60 * 1000 : Date.now();
  return new Date(end).toISOString();
}

function eventBody(input: CalendarEventInput) {
  const timeZone = input.timeZone ?? 'UTC';
  return {
    subject: input.summary,
    body: { contentType: 'HTML', content: input.description },
    start: { dateTime: input.startIso, timeZone },
    end: { dateTime: endIsoFor(input), timeZone },
    transactionId: input.sourceId,
    singleValueExtendedProperties: [
      { id: EXT_PROP_ID, value: input.sourceId },
    ],
  };
}

function defaultFetcher(): CalendarFetcher {
  return fetch as unknown as CalendarFetcher;
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

interface GraphListResponse {
  readonly value?: ReadonlyArray<{ readonly id?: string }>;
}

export function createMicrosoftCalendarProvider(
  deps: CalendarProviderDeps = {},
): CalendarEventProvider {
  const fetcher = deps.fetcher ?? defaultFetcher();

  return {
    provider: 'microsoft',
    async upsertEvent(
      accessToken: string,
      input: CalendarEventInput,
    ): Promise<CalendarUpsertResult> {
      const authHeader = { Authorization: `Bearer ${accessToken}` };
      // Graph escapes single quotes by doubling them inside an OData literal.
      const safeSourceId = input.sourceId.replace(/'/g, "''");
      const filter =
        `singleValueExtendedProperties/any(ep:ep/id eq '${EXT_PROP_ID}' ` +
        `and ep/value eq '${safeSourceId}')`;
      const listUrl =
        `${GRAPH_BASE}/me/events?$select=id&$top=1&$filter=` +
        encodeURIComponent(filter);

      try {
        // 1. Look for an existing event carrying our stamp.
        const listRes = await fetcher(listUrl, {
          method: 'GET',
          headers: { ...authHeader, Prefer: 'outlook.body-content-type="text"' },
        });

        if (listRes.ok) {
          const payload = (await listRes.json()) as GraphListResponse;
          const existingId = payload.value?.[0]?.id;
          if (existingId) {
            // 2a. PATCH the existing event (drop the immutable transactionId).
            const { transactionId: _tx, ...patchBody } = eventBody(input);
            const patchRes = await fetcher(
              `${GRAPH_BASE}/me/events/${encodeURIComponent(existingId)}`,
              {
                method: 'PATCH',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(patchBody),
              },
            );
            if (patchRes.ok) {
              return {
                status: 'updated',
                provider: 'microsoft',
                eventId: existingId,
              };
            }
            return {
              status: 'failed',
              provider: 'microsoft',
              errorCode: `ms_patch_${patchRes.status}`,
              errorMessage: (await patchRes.text().catch(() => '')).slice(0, 300),
              retryable: retryableStatus(patchRes.status),
            };
          }
        } else if (listRes.status !== 404) {
          return {
            status: 'failed',
            provider: 'microsoft',
            errorCode: `ms_list_${listRes.status}`,
            errorMessage: (await listRes.text().catch(() => '')).slice(0, 300),
            retryable: retryableStatus(listRes.status),
          };
        }

        // 2b. No existing event → POST a new one (transactionId guards retry).
        const postRes = await fetcher(`${GRAPH_BASE}/me/events`, {
          method: 'POST',
          headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody(input)),
        });
        if (postRes.ok) {
          const created = (await postRes.json()) as { readonly id?: string };
          return {
            status: 'created',
            provider: 'microsoft',
            eventId: created.id ?? input.sourceId,
          };
        }
        return {
          status: 'failed',
          provider: 'microsoft',
          errorCode: `ms_post_${postRes.status}`,
          errorMessage: (await postRes.text().catch(() => '')).slice(0, 300),
          retryable: retryableStatus(postRes.status),
        };
      } catch (err) {
        return {
          status: 'failed',
          provider: 'microsoft',
          errorCode: 'ms_network_error',
          errorMessage: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
      }
    },
  };
}
