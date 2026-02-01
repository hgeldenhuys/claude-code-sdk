/**
 * Polling Hook
 *
 * Periodically fetches data from a URL. Used for low-frequency endpoints
 * like pastes that don't have SSE streams.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UsePollOptions {
  intervalMs: number;
  enabled?: boolean;
}

interface UsePollResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Poll a URL at a fixed interval.
 */
export function usePoll<T>(
  fetchFn: () => Promise<T>,
  options: UsePollOptions
): UsePollResult<T> {
  const { intervalMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);

    try {
      const result = await fetchFn();
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchFn, enabled]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      doFetch();
      intervalRef.current = setInterval(doFetch, intervalMs);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [doFetch, intervalMs, enabled]);

  return { data, loading, error, refresh: doFetch };
}
