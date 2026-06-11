/**
 * react-query bindings for the control plane (`/api/platform/control-plane/*`).
 *
 * Read hooks hydrate the four panels (powers, llm-routing, model-catalog).
 * Mutation hooks PUT power-flag / routing changes and POST the suggest-only
 * recommender. Every mutation invalidates the relevant read so the audit /
 * last-set-by state re-hydrates after a write. Live-only: failures propagate
 * to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPowers,
  setPowerFlag,
  fetchRouting,
  setRouting,
  fetchModelCatalog,
  runAiSuggest,
  type PowerFlag,
  type SetPowerFlagInput,
  type SetPowerFlagResult,
  type Scope,
  type SetRoutingInput,
  type SetRoutingResult,
  type AiSuggestInput,
  type AiSuggestResult,
} from './api';

const CATALOG_KEY = ['control-plane', 'model-catalog'] as const;
const powersKey = (flags: ReadonlyArray<string>) =>
  ['control-plane', 'powers', [...flags].sort().join(',')] as const;
const routingKey = (scope: Scope) => ['control-plane', 'llm-routing', scope] as const;

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useModelCatalogQuery() {
  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: fetchModelCatalog,
    staleTime: 5 * 60_000,
  });
}

export function usePowersQuery(flags: ReadonlyArray<string>) {
  return useQuery<ReadonlyArray<PowerFlag>>({
    queryKey: powersKey(flags),
    queryFn: () => fetchPowers(flags),
    enabled: flags.length > 0,
  });
}

export function useRoutingQuery(scope: Scope) {
  return useQuery({
    queryKey: routingKey(scope),
    queryFn: () => fetchRouting(scope),
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useSetPowerFlag(flags: ReadonlyArray<string>) {
  const qc = useQueryClient();
  return useMutation<SetPowerFlagResult, Error, SetPowerFlagInput>({
    mutationFn: setPowerFlag,
    onSettled: () => qc.invalidateQueries({ queryKey: powersKey(flags) }),
  });
}

export function useSetRouting(scope: Scope) {
  const qc = useQueryClient();
  return useMutation<SetRoutingResult, Error, SetRoutingInput>({
    mutationFn: setRouting,
    onSettled: () => qc.invalidateQueries({ queryKey: routingKey(scope) }),
  });
}

export function useAiSuggest() {
  return useMutation<AiSuggestResult, Error, AiSuggestInput>({
    mutationFn: runAiSuggest,
  });
}
