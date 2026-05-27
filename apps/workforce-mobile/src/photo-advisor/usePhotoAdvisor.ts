import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { analyzePhoto } from './pipeline'
import type {
  AnalyzePhotoArgs,
  PhotoAdvisorError,
  PhotoAdvisorResponse
} from './types'

/**
 * Thin react-query wrapper around `analyzePhoto`. We use a mutation (not
 * a query) because the user fires this on demand from a button — it has
 * no idempotent input key, and we never want it to refetch on focus.
 *
 * Retries are disabled: the underlying pipeline already maps fetch
 * failures to typed errors, and the BACKEND_VISION_UNAVAILABLE state is
 * deterministic (retrying would only spam the gateway).
 */
export function usePhotoAdvisor(): UseMutationResult<
  PhotoAdvisorResponse,
  PhotoAdvisorError,
  AnalyzePhotoArgs
> {
  return useMutation<PhotoAdvisorResponse, PhotoAdvisorError, AnalyzePhotoArgs>({
    mutationKey: ['photo-advisor', 'analyze'],
    mutationFn: (args) => analyzePhoto(args),
    retry: 0
  })
}
