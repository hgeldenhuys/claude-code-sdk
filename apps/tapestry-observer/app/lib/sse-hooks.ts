/**
 * SSE Subscription Hooks
 *
 * React hooks for subscribing to SignalDB Server-Sent Events streams
 * through the BFF proxy (/api/proxy). No API keys are sent from the browser —
 * the server-side proxy injects credentials.
 *
 * Handles connection management, reconnection, keepalive, and state updates.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, Channel, Message } from "./types";

// ============================================================================
// Types
// ============================================================================

interface UseSSEOptions {
  enabled?: boolean;
}

export type StreamMode = "live" | "polling" | "offline";

interface SSEState<T> {
  data: T[];
  connected: boolean;
  error: Error | null;
  mode: StreamMode;
}

type EntityType = "agents" | "channels" | "messages";

// All requests go through the BFF proxy
const BASE_URL = "/api/proxy";

// ============================================================================
// Case Conversion Utilities
// ============================================================================

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamelCase<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysToCamelCase(item)) as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = convertKeysToCamelCase(
        (obj as Record<string, unknown>)[key]
      );
    }
    return result as T;
  }

  return obj as T;
}

// ============================================================================
// SSE Parser
// ============================================================================

interface ParsedSSEEvent {
  id: string | null;
  event: string;
  data: unknown;
}

function parseSSEFrame(frame: string): ParsedSSEEvent | null {
  let id: string | null = null;
  let event = "message";
  const dataLines: string[] = [];

  const lines = frame.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    if (line.startsWith(":")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx);
    const rawValue = line.slice(colonIdx + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    switch (field) {
      case "id":
        id = value;
        break;
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    data = rawData;
  }

  return { id, event, data };
}

// ============================================================================
// useTableStream Hook
// ============================================================================

/**
 * Subscribe to a SignalDB table's SSE stream via the BFF proxy.
 *
 * No API keys or Authorization headers are sent from the browser.
 * The server-side proxy (/api/proxy/*) injects credentials.
 */
export function useTableStream<T extends { id: string }>(
  table: EntityType,
  options: UseSSEOptions
): SSEState<T> & { refresh: () => void } {
  const { enabled = true } = options;

  const [state, setState] = useState<SSEState<T>>({
    data: [],
    connected: false,
    error: null,
    mode: "offline",
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(1000);
  const sseFailCountRef = useRef(0);
  const mountedRef = useRef(true);
  const lastEventIdRef = useRef<string | null>(null);
  const lastEventTimeRef = useRef<number>(Date.now());

  // Clear keepalive interval
  const clearKeepalive = useCallback(() => {
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
  }, []);

  // Start keepalive ping (no auth header — proxy handles it)
  const startKeepalive = useCallback(() => {
    clearKeepalive();

    keepaliveIntervalRef.current = setInterval(async () => {
      const idleMs = Date.now() - lastEventTimeRef.current;
      if (idleMs < 6000) return;

      try {
        const resp = await fetch(`${BASE_URL}/v1/agents?limit=1`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          throw new Error(`Keepalive failed: ${resp.status}`);
        }
      } catch {
        if (mountedRef.current) {
          abortControllerRef.current?.abort();
        }
      }
    }, 8000);
  }, [clearKeepalive]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Fetch initial data (no auth header — proxy handles it)
  const fetchInitialData = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/v1/${table}?limit=500`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${table}: ${response.statusText}`);
      }

      const json = await response.json();
      const data = json.data || json;
      const converted = convertKeysToCamelCase<T[]>(data);

      if (mountedRef.current) {
        setState((prev) => ({ ...prev, data: converted, error: null }));
      }
    } catch (err) {
      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    }
  }, [table]);

  // Start polling fallback (every 10s)
  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        fetchInitialData();
      }
    }, 10_000);
  }, [stopPolling, fetchInitialData]);

  // Connect to SSE stream (no auth header — proxy handles it)
  const connect = useCallback(async () => {
    if (!enabled) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };

    if (lastEventIdRef.current) {
      headers["Last-Event-ID"] = lastEventIdRef.current;
    }

    try {
      const response = await fetch(`${BASE_URL}/v1/${table}/stream`, {
        method: "GET",
        headers,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(
          `SSE connection failed: ${response.status} ${response.statusText}`
        );
      }

      if (!response.body) {
        throw new Error("SSE response has no body");
      }

      // Connected - reset backoff and fail count, switch to live mode
      backoffRef.current = 1000;
      sseFailCountRef.current = 0;
      lastEventTimeRef.current = Date.now();
      stopPolling();
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, connected: true, error: null, mode: "live" }));
      }

      // Start keepalive
      startKeepalive();

      // Process stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let delimIdx: number;
        while ((delimIdx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, delimIdx);
          buffer = buffer.slice(delimIdx + 2);

          const parsedEvent = parseSSEFrame(frame);
          if (!parsedEvent) continue;

          if (parsedEvent.id !== null) {
            lastEventIdRef.current = parsedEvent.id;
          }

          lastEventTimeRef.current = Date.now();

          const eventType = parsedEvent.event;
          const rawEvent = parsedEvent.data;

          if (!rawEvent || typeof rawEvent !== "object") continue;

          const record = rawEvent as Record<string, unknown>;
          if (!record.id) continue;

          const entityData =
            record.data && typeof record.data === "object"
              ? { id: record.id, ...(record.data as Record<string, unknown>) }
              : record;

          const converted = convertKeysToCamelCase<T>(entityData);

          if (!mountedRef.current) continue;

          setState((prev) => {
            let newData = [...prev.data];

            switch (eventType) {
              case "insert":
              case "initial":
                if (!newData.some((item) => item.id === converted.id)) {
                  newData = [...newData, converted];
                }
                break;
              case "update":
                newData = newData.map((item) =>
                  item.id === converted.id ? { ...item, ...converted } : item
                );
                break;
              case "delete":
                newData = newData.filter((item) => item.id !== converted.id);
                break;
              default: {
                const idx = newData.findIndex(
                  (item) => item.id === converted.id
                );
                if (idx >= 0) {
                  newData[idx] = { ...newData[idx], ...converted };
                } else {
                  newData = [...newData, converted];
                }
              }
            }

            return { ...prev, data: newData };
          });
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (mountedRef.current) {
          clearKeepalive();
          setState((prev) => ({ ...prev, connected: false }));
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 100);
        }
        return;
      }

      sseFailCountRef.current++;

      if (mountedRef.current) {
        clearKeepalive();

        if (sseFailCountRef.current >= 3) {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: null,
            mode: prev.data.length > 0 ? "polling" : "offline",
          }));
          startPolling();
          reconnectTimeoutRef.current = setTimeout(() => {
            sseFailCountRef.current = 0;
            connect();
          }, 60_000);
        } else {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: err instanceof Error ? err : new Error(String(err)),
          }));
          reconnectTimeoutRef.current = setTimeout(() => {
            backoffRef.current = Math.min(backoffRef.current * 2, 30000);
            connect();
          }, backoffRef.current);
        }
      }
      return;
    }

    // Stream ended cleanly - reconnect
    if (mountedRef.current) {
      clearKeepalive();
      setState((prev) => ({ ...prev, connected: false, error: null }));
      reconnectTimeoutRef.current = setTimeout(connect, backoffRef.current);
    }
  }, [enabled, table, startKeepalive, clearKeepalive, startPolling, stopPolling]);

  // Refresh function
  const refresh = useCallback(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Initial data fetch and SSE connection
  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      fetchInitialData();
      connect();
    }

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      clearKeepalive();
      stopPolling();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, fetchInitialData, connect, clearKeepalive, stopPolling]);

  return { ...state, refresh };
}

// ============================================================================
// Convenience Hooks
// ============================================================================

export function useAgents(options: UseSSEOptions) {
  return useTableStream<Agent>("agents", options);
}

export function useChannels(options: UseSSEOptions) {
  return useTableStream<Channel>("channels", options);
}

export function useMessages(options: UseSSEOptions) {
  return useTableStream<Message>("messages", options);
}
