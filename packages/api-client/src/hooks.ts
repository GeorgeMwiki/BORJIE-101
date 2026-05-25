/**
 * React Hooks for API Client - BORJIE
 *
 * Type-safe React hooks for data fetching:
 * - useQuery - for GET requests with caching
 * - useMutation - for POST/PUT/PATCH/DELETE
 * - useInfiniteQuery - for paginated lists
 * - usePrefetch - for prefetching data
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  ApiClient,
  ApiClientError,
  getApiClient,
  type ApiResponse,
  type PaginatedResponse,
  type PaginationParams,
  type RequestOptions,
} from './client';

// ============================================================================
// Types
// ============================================================================

export interface QueryOptions<TData> {
  /** Enable/disable the query */
  enabled?: boolean;
  /** Refetch interval in milliseconds */
  refetchInterval?: number;
  /** Refetch on window focus */
  refetchOnFocus?: boolean;
  /** Refetch on reconnect */
  refetchOnReconnect?: boolean;
  /** Cache time in milliseconds */
  cacheTime?: number;
  /** Stale time in milliseconds */
  staleTime?: number;
  /** Retry count on failure */
  retry?: number | boolean;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Initial data */
  initialData?: TData;
  /** Placeholder data while loading */
  placeholderData?: TData;
  /** Transform response data */
  select?: (data: TData) => TData;
  /** Called on success */
  onSuccess?: (data: TData) => void;
  /** Called on error */
  onError?: (error: ApiClientError) => void;
  /** Called when query settles */
  onSettled?: (data: TData | undefined, error: ApiClientError | null) => void;
  /** Request options */
  requestOptions?: RequestOptions;
}

export interface QueryResult<TData> {
  data: TData | undefined;
  error: ApiClientError | null;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  isStale: boolean;
  refetch: () => Promise<void>;
  invalidate: () => void;
}

export interface MutationOptions<TData, TVariables> {
  /** Called before mutation executes */
  onMutate?: (variables: TVariables) => void | Promise<void>;
  /** Called on success */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  /** Called on error */
  onError?: (error: ApiClientError, variables: TVariables) => void | Promise<void>;
  /** Called when mutation settles */
  onSettled?: (
    data: TData | undefined,
    error: ApiClientError | null,
    variables: TVariables
  ) => void | Promise<void>;
  /** Retry count */
  retry?: number;
  /** Request options */
  requestOptions?: RequestOptions;
}

export interface MutationResult<TData, TVariables> {
  data: TData | undefined;
  error: ApiClientError | null;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isIdle: boolean;
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  reset: () => void;
}

export interface InfiniteQueryOptions<TData> extends Omit<QueryOptions<TData[]>, 'initialData'> {
  getNextPageParam?: (lastPage: PaginatedResponse<TData>, allPages: PaginatedResponse<TData>[]) => number | undefined;
  initialPageParam?: number;
}

export interface InfiniteQueryResult<TData> {
  data: TData[];
  pages: PaginatedResponse<TData>[];
  error: ApiClientError | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isSuccess: boolean;
  isError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
}

type MutationFn<TData, TVariables> = (
  client: ApiClient,
  variables: TVariables
) => Promise<ApiResponse<TData>>;

// ============================================================================
// Simple In-Memory Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  staleTime: number;
}

const queryCache = new Map<string, CacheEntry<unknown>>();

function getCacheKey(path: string, params?: Record<string, unknown>): string {
  return `${path}:${params ? JSON.stringify(params) : ''}`;
}

function getFromCache<T>(key: string): T | undefined {
  const entry = queryCache.get(key);
  if (!entry) return undefined;

  const isStale = Date.now() - entry.timestamp > entry.staleTime;
  if (isStale) {
    queryCache.delete(key);
    return undefined;
  }

  return entry.data as T;
}

function setInCache<T>(key: string, data: T, staleTime: number): void {
  queryCache.set(key, {
    data,
    timestamp: Date.now(),
    staleTime,
  });
}

function invalidateCache(keyPattern?: string): void {
  if (!keyPattern) {
    queryCache.clear();
    return;
  }

  for (const key of queryCache.keys()) {
    if (key.startsWith(keyPattern)) {
      queryCache.delete(key);
    }
  }
}

// ============================================================================
// useQuery Hook
// ============================================================================

export function useQuery<TData>(
  path: string,
  options: QueryOptions<TData> = {}
): QueryResult<TData> {
  const {
    enabled = true,
    refetchInterval,
    refetchOnFocus = true,
    refetchOnReconnect = true,
    cacheTime = 5 * 60 * 1000, // 5 minutes
    staleTime = 0,
    retry = 3,
    retryDelay = 1000,
    initialData,
    placeholderData,
    select,
    onSuccess,
    onError,
    onSettled,
    requestOptions,
  } = options;

  const cacheKey = getCacheKey(path, requestOptions?.params);
  const cachedData = getFromCache<TData>(cacheKey);

  const [data, setData] = useState<TData | undefined>(
    cachedData ?? initialData ?? placeholderData
  );
  const [error, setError] = useState<ApiClientError | null>(null);
  const [isLoading, setIsLoading] = useState(!cachedData && enabled);
  const [isFetching, setIsFetching] = useState(false);
  const [isStale, setIsStale] = useState(Boolean(cachedData));

  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setIsFetching(true);
    if (!data) setIsLoading(true);

    try {
      const client = getApiClient();
      const response = await client.get<TData>(path, requestOptions);

      if (!mountedRef.current) return;

      let transformedData = response.data;
      if (select) {
        transformedData = select(transformedData);
      }

      setData(transformedData);
      setError(null);
      setIsStale(false);
      setInCache(cacheKey, transformedData, cacheTime);
      retryCountRef.current = 0;

      onSuccess?.(transformedData);
      onSettled?.(transformedData, null);
    } catch (err) {
      if (!mountedRef.current) return;

      const apiError =
        err instanceof ApiClientError
          ? err
          : new ApiClientError('UNKNOWN', String(err));

      // Handle retry
      const maxRetries = typeof retry === 'number' ? retry : retry ? 3 : 0;
      if (apiError.isRetryable && retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        setTimeout(() => fetchData(), retryDelay * retryCountRef.current);
        return;
      }

      setError(apiError);
      retryCountRef.current = 0;

      onError?.(apiError);
      onSettled?.(undefined, apiError);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsFetching(false);
      }
    }
  }, [
    enabled,
    path,
    cacheKey,
    cacheTime,
    retry,
    retryDelay,
    select,
    onSuccess,
    onError,
    onSettled,
    requestOptions,
    data,
  ]);

  const refetch = useCallback(async () => {
    invalidateCache(cacheKey);
    await fetchData();
  }, [cacheKey, fetchData]);

  const invalidate = useCallback(() => {
    invalidateCache(cacheKey);
    setIsStale(true);
  }, [cacheKey]);

  // Initial fetch
  useEffect(() => {
    if (enabled && !cachedData) {
      fetchData();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, fetchData, cachedData]);

  // Refetch interval
  useEffect(() => {
    if (!refetchInterval || !enabled) return;

    const interval = setInterval(fetchData, refetchInterval);
    return () => clearInterval(interval);
  }, [refetchInterval, enabled, fetchData]);

  // Refetch on focus
  useEffect(() => {
    if (!refetchOnFocus || !enabled) return;

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    document.addEventListener('visibilitychange', handleFocus);
    return () => document.removeEventListener('visibilitychange', handleFocus);
  }, [refetchOnFocus, enabled, fetchData]);

  // Refetch on reconnect
  useEffect(() => {
    if (!refetchOnReconnect || !enabled) return;

    const handleOnline = () => fetchData();

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refetchOnReconnect, enabled, fetchData]);

  return {
    data,
    error,
    isLoading,
    isFetching,
    isSuccess: !isLoading && !error && data !== undefined,
    isError: error !== null,
    isStale,
    refetch,
    invalidate,
  };
}

// ============================================================================
// useMutation Hook
// ============================================================================

export function useMutation<TData, TVariables = void>(
  mutationFn: MutationFn<TData, TVariables>,
  options: MutationOptions<TData, TVariables> = {}
): MutationResult<TData, TVariables> {
  const { onMutate, onSuccess, onError, onSettled, retry = 0 } = options;

  const [state, setState] = useState<{
    data: TData | undefined;
    error: ApiClientError | null;
    status: 'idle' | 'loading' | 'success' | 'error';
  }>({
    data: undefined,
    error: null,
    status: 'idle',
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      setState((prev) => ({ ...prev, status: 'loading', error: null }));

      try {
        await onMutate?.(variables);

        const client = getApiClient();

        let response: ApiResponse<TData>;
        let lastError: ApiClientError | null = null;
        let attempts = 0;
        const maxAttempts = retry + 1;

        while (attempts < maxAttempts) {
          try {
            response = await mutationFn(client, variables);
            break;
          } catch (err) {
            lastError =
              err instanceof ApiClientError
                ? err
                : new ApiClientError('UNKNOWN', String(err));

            if (!lastError.isRetryable || attempts >= maxAttempts - 1) {
              throw lastError;
            }

            attempts++;
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * attempts)
            );
          }
        }

        if (!mountedRef.current) {
          return response!.data;
        }

        setState({ data: response!.data, error: null, status: 'success' });

        await onSuccess?.(response!.data, variables);
        await onSettled?.(response!.data, null, variables);

        return response!.data;
      } catch (err) {
        const apiError =
          err instanceof ApiClientError
            ? err
            : new ApiClientError('UNKNOWN', String(err));

        if (mountedRef.current) {
          setState({ data: undefined, error: apiError, status: 'error' });
        }

        await onError?.(apiError, variables);
        await onSettled?.(undefined, apiError, variables);

        throw apiError;
      }
    },
    [mutationFn, retry, onMutate, onSuccess, onError, onSettled]
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      mutateAsync(variables).catch(() => {
        // Error handled by callbacks
      });
    },
    [mutateAsync]
  );

  const reset = useCallback(() => {
    setState({ data: undefined, error: null, status: 'idle' });
  }, []);

  return {
    data: state.data,
    error: state.error,
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    isIdle: state.status === 'idle',
    mutate,
    mutateAsync,
    reset,
  };
}

// ============================================================================
// useInfiniteQuery Hook
// ============================================================================

export function useInfiniteQuery<TData>(
  path: string,
  options: InfiniteQueryOptions<TData> = {}
): InfiniteQueryResult<TData> {
  const {
    enabled = true,
    getNextPageParam = (lastPage) =>
      lastPage.pagination.hasNextPage
        ? lastPage.pagination.page + 1
        : undefined,
    initialPageParam = 1,
    onSuccess,
    onError,
    requestOptions,
  } = options;

  const [pages, setPages] = useState<PaginatedResponse<TData>[]>([]);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  const mountedRef = useRef(true);

  const fetchPage = useCallback(
    async (pageParam: number, isNextPage = false) => {
      if (isNextPage) {
        setIsFetchingNextPage(true);
      } else {
        setIsFetching(true);
        if (pages.length === 0) setIsLoading(true);
      }

      try {
        const client = getApiClient();
        const response = await client.list<TData>(path, { page: pageParam }, requestOptions);

        if (!mountedRef.current) return;

        setPages((prev) => (isNextPage ? [...prev, response] : [response]));
        setError(null);

        onSuccess?.(response.data);
      } catch (err) {
        if (!mountedRef.current) return;

        const apiError =
          err instanceof ApiClientError
            ? err
            : new ApiClientError('UNKNOWN', String(err));

        setError(apiError);
        onError?.(apiError);
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsFetching(false);
          setIsFetchingNextPage(false);
        }
      }
    },
    [path, requestOptions, onSuccess, onError, pages.length]
  );

  const fetchNextPage = useCallback(async () => {
    if (pages.length === 0) return;

    const lastPage = pages[pages.length - 1];
    if (!lastPage) return;
    const nextPageParam = getNextPageParam(lastPage, pages);

    if (nextPageParam !== undefined) {
      await fetchPage(nextPageParam, true);
    }
  }, [pages, getNextPageParam, fetchPage]);

  const refetch = useCallback(async () => {
    setPages([]);
    await fetchPage(initialPageParam);
  }, [fetchPage, initialPageParam]);

  useEffect(() => {
    if (enabled) {
      fetchPage(initialPageParam);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, fetchPage, initialPageParam]);

  const hasNextPage = useMemo(() => {
    if (pages.length === 0) return false;
    const lastPage = pages[pages.length - 1];
    if (!lastPage) return false;
    return getNextPageParam(lastPage, pages) !== undefined;
  }, [pages, getNextPageParam]);

  const data = useMemo(
    () => pages.flatMap((page) => page.data),
    [pages]
  );

  return {
    data,
    pages,
    error,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isSuccess: !isLoading && !error && pages.length > 0,
    isError: error !== null,
    hasNextPage,
    fetchNextPage,
    refetch,
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Prefetch data into cache
 */
export function usePrefetch<TData>(
  path: string,
  options?: RequestOptions
): () => Promise<void> {
  return useCallback(async () => {
    const cacheKey = getCacheKey(path, options?.params);
    const cached = getFromCache<TData>(cacheKey);

    if (cached) return;

    try {
      const client = getApiClient();
      const response = await client.get<TData>(path, options);
      setInCache(cacheKey, response.data, 5 * 60 * 1000);
    } catch {
      // Silently fail prefetch
    }
  }, [path, options]);
}

/**
 * Invalidate queries by path pattern
 */
export function useInvalidateQueries(): (pattern?: string) => void {
  return useCallback((pattern?: string) => {
    invalidateCache(pattern);
  }, []);
}

/**
 * Check if client has valid auth token
 */
export function useIsAuthenticated(): boolean {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    try {
      const client = getApiClient();
      setIsAuthenticated(client.hasValidToken());
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  return isAuthenticated;
}

// ============================================================================
// Pre-built Mutation Hooks
// ============================================================================

export function useCreateMutation<TData, TInput>(
  path: string,
  options?: MutationOptions<TData, TInput>
) {
  return useMutation<TData, TInput>(
    (client, input) => client.post<TData>(path, input),
    options
  );
}

export function useUpdateMutation<TData, TInput extends { id: string }>(
  basePath: string,
  options?: MutationOptions<TData, TInput>
) {
  return useMutation<TData, TInput>(
    (client, input) => client.put<TData>(`${basePath}/${input.id}`, input),
    options
  );
}

export function usePatchMutation<TData, TInput extends { id: string }>(
  basePath: string,
  options?: MutationOptions<TData, TInput>
) {
  return useMutation<TData, TInput>(
    (client, input) => client.patch<TData>(`${basePath}/${input.id}`, input),
    options
  );
}

export function useDeleteMutation<TData = void>(
  basePath: string,
  options?: MutationOptions<TData, string>
) {
  return useMutation<TData, string>(
    (client, id) => client.delete<TData>(`${basePath}/${id}`),
    options
  );
}
