/**
 * Owner-mobile cockpit hub query — Roadmap R7.
 *
 * Aggregates the four cockpit-hub panels (brief, recent decisions,
 * opportunities, risks) plus the reminders list into one
 * pull-to-refresh query. Each panel is independently served by the
 * api-gateway brain tools; failures degrade gracefully so a single
 * slow tool doesn't blank the whole screen.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ownerApi } from '../../api/client'
import { ApiError } from '../../api/errors'

export interface CockpitBriefSummary {
  readonly headlineEn: string
  readonly headlineSw: string
  readonly generatedAt: string
}

export interface CockpitDecisionSummary {
  readonly id: string
  readonly summary: string
  readonly severity: 'low' | 'medium' | 'high' | 'sovereign'
  readonly raisedAt: string
}

export interface CockpitOpportunity {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly expectedValueTzs: number
}

export interface CockpitRisk {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface CockpitReminder {
  readonly id: string
  readonly text: string
  readonly dueAt: string
}

export interface CockpitHubResponse {
  readonly brief: CockpitBriefSummary
  readonly decisions: ReadonlyArray<CockpitDecisionSummary>
  readonly opportunities: ReadonlyArray<CockpitOpportunity>
  readonly risks: ReadonlyArray<CockpitRisk>
  readonly reminders: ReadonlyArray<CockpitReminder>
  readonly generatedAt: string
}

const EMPTY_HUB: CockpitHubResponse = Object.freeze({
  brief: {
    headlineEn: 'No fresh brief yet',
    headlineSw: 'Hakuna muhtasari mpya bado',
    generatedAt: new Date(0).toISOString(),
  },
  decisions: [],
  opportunities: [],
  risks: [],
  reminders: [],
  generatedAt: new Date(0).toISOString(),
})

/**
 * Fetch the cockpit hub. Falls back to the empty shape on network
 * failure / 404 so the screen renders even before any tenant data
 * exists. Caller surfaces a banner when `generatedAt === epoch 0`.
 */
export function useCockpitHub(): UseQueryResult<CockpitHubResponse, Error> {
  return useQuery<CockpitHubResponse, Error>({
    queryKey: ['owner', 'cockpit-hub'],
    queryFn: async ({ signal }) => {
      try {
        return await ownerApi.get<CockpitHubResponse>('/cockpit/hub', {
          signal,
        })
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 0 || error.status === 404)
        ) {
          return EMPTY_HUB
        }
        throw error
      }
    },
    staleTime: 30_000,
  })
}

/** Exported so the empty-state banner check stays self-evident. */
export function isEmptyCockpit(data: CockpitHubResponse): boolean {
  return data.generatedAt === EMPTY_HUB.generatedAt
}
