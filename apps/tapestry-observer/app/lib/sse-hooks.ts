/**
 * SSE Subscription Hooks
 *
 * React hooks for subscribing to SignalDB Server-Sent Events streams.
 * Handles connection management, reconnection, and state updates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Channel, Message } from "./types";

// ============================================================================
// Types
// ============================================================================

interface UseSSEOptions {
  apiUrl: string;
  apiKey: string;
  enabled?: boolean;
  useProxy?: boolean; // Use /api/proxy/* to avoid CORS
}

interface SSEState<T> {
  data: T[];
  connected: boolean;
  error: Error | null;
  lastEventId: string | null;
}

type EntityType = "agents" | "channels" | "messages";

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
 * Subscribe to a SignalDB table's SSE stream for real-time updates.
 */
export function useTableStream<T extends { id: string }>(
  table: EntityType,
  options: UseSSEOptions
): SSEState<T> & { refresh: () => void } {
  const { apiUrl, apiKey, enabled = true, useProxy = false } = options; // CORS now enabled on API

  // Use proxy to avoid CORS issues when running in browser
  const baseUrl = useMemo(() => {
    if (useProxy && typeof window !== "undefined") {
      return "/api/proxy";
    }
    return apiUrl;
  }, [useProxy, apiUrl]);

  const [state, setState] = useState<SSEState<T>>({
    data: [],
    connected: false,
    error: null,
    lastEventId: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);

  // Fetch initial data
  const fetchInitialData = useCallback(async () => {
    if (!apiKey || !baseUrl) return;

    try {
      const response = await fetch(`${baseUrl}/v1/${table}?limit=500`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
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
  }, [baseUrl, apiKey, table]);

  // Connect to SSE stream
  const connect = useCallback(async () => {
    if (!enabled || !apiKey || !baseUrl) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "text/event-stream",
      // Note: Cache-Control not allowed by CORS
    };

    if (state.lastEventId) {
      headers["Last-Event-ID"] = state.lastEventId;
    }

    try {
      const response = await fetch(`${baseUrl}/v1/${table}/stream`, {
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

      // Connected - reset backoff
      backoffRef.current = 1000;
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, connected: true, error: null }));
      }

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

          if (parsedEvent.id !== null && mountedRef.current) {
            setState((prev) => ({ ...prev, lastEventId: parsedEvent.id }));
          }

          const eventType = parsedEvent.event;
          const eventData = parsedEvent.data;

          if (!eventData || typeof eventData !== "object") continue;

          const converted = convertKeysToCamelCase<T>(eventData);

          if (!mountedRef.current) continue;

          setState((prev) => {
            let newData = [...prev.data];

            switch (eventType) {
              case "insert":
              case "initial":
                // Add if not exists
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
              default:
                // For generic "message" events, treat as upsert
                const idx = newData.findIndex(
                  (item) => item.id === converted.id
                );
                if (idx >= 0) {
                  newData[idx] = { ...newData[idx], ...converted };
                } else {
                  newData = [...newData, converted];
                }
            }

            return { ...prev, data: newData };
          });
        }
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          connected: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));

        // Schedule reconnect with exponential backoff
        reconnectTimeoutRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, 30000);
          connect();
        }, backoffRef.current);
      }
    }

    // Stream ended - reconnect (clear error since it ended cleanly)
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, connected: false, error: null }));
      reconnectTimeoutRef.current = setTimeout(connect, backoffRef.current);
    }
  }, [enabled, baseUrl, apiKey, table, state.lastEventId]);

  // Refresh function
  const refresh = useCallback(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Initial data fetch and SSE connection
  useEffect(() => {
    mountedRef.current = true;

    if (enabled && apiKey && baseUrl) {
      fetchInitialData();
      connect();
    }

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, apiKey, baseUrl, fetchInitialData, connect]);

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
