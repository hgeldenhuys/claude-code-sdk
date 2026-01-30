/**
 * URL State Hook
 *
 * Wraps useSearchParams() for URL-based filter state.
 * Every filter/selection across all views uses this instead of useState.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router";

/**
 * Use URL search params as state.
 * Returns [value, setter] tuple like useState but persists in URL.
 */
export function useUrlState(
  key: string,
  defaultValue = ""
): [string, (v: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = searchParams.get(key) || defaultValue;

  const setValue = useCallback(
    (v: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === defaultValue || v === "") {
            next.delete(key);
          } else {
            next.set(key, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [key, defaultValue, setSearchParams]
  );

  return [value, setValue];
}
