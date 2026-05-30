/**
 * Superpower 7 — search FAB (mobile equivalent of cmd-K).
 *
 * The bootstrap renders the FAB itself; this module owns the query API
 * and the recent-target cache so the FAB can open instantly.
 */
import { miningApi } from '../api/client'
import type { NavigateTarget } from './navigate'

export interface SearchResult extends NavigateTarget {
  readonly description?: string
}

interface SearchApiResponse {
  readonly success: boolean
  readonly data?: { readonly results: ReadonlyArray<SearchResult> }
}

let recents: ReadonlyArray<SearchResult> = []

export function rememberRecentSearch(result: SearchResult): void {
  recents = [result, ...recents.filter((r) => r.route !== result.route)].slice(0, 8)
}

export function getRecentSearches(): ReadonlyArray<SearchResult> {
  return recents
}

/**
 * Hit the universal-search endpoint. Persona = worker → server filters
 * to worker-visible entities. Returns an empty list on network failure
 * rather than throwing — the FAB stays usable offline.
 */
export async function runUniversalSearch(query: string): Promise<ReadonlyArray<SearchResult>> {
  const q = query.trim()
  if (q.length === 0) return []
  try {
    const res = await miningApi.get<SearchApiResponse>('/superpowers/search', {
      query: { q, persona: 'worker', limit: 20 }
    })
    if (res?.success && res.data?.results) {
      return res.data.results
    }
  } catch {
    // ignore
  }
  return []
}
