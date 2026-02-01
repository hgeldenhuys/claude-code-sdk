/**
 * SignalDB Context Provider
 *
 * Provides SignalDB connection state and data to the component tree.
 * No API keys are stored client-side — the BFF proxy handles credentials.
 * On mount, fetches /api/config to check if the server is configured.
 *
 * IMPORTANT: Only COMMS data (agents, channels, messages) is streamed globally.
 * Transcript lines and hook events are NOT streamed here — they're too large
 * and would cause constant re-renders across the entire app. Instead, we poll
 * lightweight counts for sidebar badges, and each route creates its own local
 * stream with sensible maxItems caps.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAgents, useChannels, useCollectionCounts, useMessages } from "./sse-hooks";
import type { Agent, Channel, ConnectionState, Message, StreamMode } from "./types";

// ============================================================================
// Context Types
// ============================================================================

interface SignalDBContextValue {
  // Connection
  configured: boolean;
  configLoading: boolean;
  apiHost: string | null;
  connected: ConnectionState;

  // COMMS Data (streamed via SSE)
  agents: Agent[];
  channels: Channel[];
  messages: Message[];

  // Transcript Counts (lightweight polling, NOT full data)
  transcriptCounts: {
    lines: number;
    hookEvents: number;
    sessions: number;
  };

  // Errors
  errors: {
    agents: Error | null;
    channels: Error | null;
    messages: Error | null;
  };

  // Actions
  refresh: () => void;
}

const SignalDBContext = createContext<SignalDBContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

interface SignalDBProviderProps {
  children: ReactNode;
}

export function SignalDBProvider({ children }: SignalDBProviderProps) {
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [apiHost, setApiHost] = useState<string | null>(null);

  // Check server config on mount
  useEffect(() => {
    let cancelled = false;

    async function checkConfig() {
      try {
        const resp = await fetch("/api/config");
        if (!resp.ok) {
          throw new Error(`Config check failed: ${resp.status}`);
        }
        const data = await resp.json();
        if (!cancelled) {
          setConfigured(data.configured === true);
          setApiHost(data.apiHost || null);
        }
      } catch {
        if (!cancelled) {
          setConfigured(false);
        }
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    }

    checkConfig();
    return () => { cancelled = true; };
  }, []);

  // SSE options — enabled only when server is configured
  const sseOptions = useMemo(
    () => ({ enabled: configured }),
    [configured]
  );

  // Subscribe to COMMS tables only (small, bounded collections)
  const agentsStream = useAgents(sseOptions);
  const channelsStream = useChannels(sseOptions);
  const messagesStream = useMessages(sseOptions);

  // Lightweight count polling for transcript data (every 30s)
  const { counts, refreshCounts } = useCollectionCounts({
    enabled: configured,
    intervalMs: 30_000,
  });

  // Connection state — derive overall mode from COMMS streams only
  const connected = useMemo<ConnectionState>(() => {
    const modes = [agentsStream.mode, channelsStream.mode, messagesStream.mode];
    let overallMode: StreamMode = "offline";
    if (modes.some((m) => m === "live")) {
      overallMode = "live";
    } else if (modes.some((m) => m === "polling")) {
      overallMode = "polling";
    }
    return {
      agents: agentsStream.connected,
      channels: channelsStream.connected,
      messages: messagesStream.connected,
      mode: overallMode,
    };
  }, [
    agentsStream.connected, channelsStream.connected, messagesStream.connected,
    agentsStream.mode, channelsStream.mode, messagesStream.mode,
  ]);

  // Errors
  const errors = useMemo(
    () => ({
      agents: agentsStream.error,
      channels: channelsStream.error,
      messages: messagesStream.error,
    }),
    [agentsStream.error, channelsStream.error, messagesStream.error]
  );

  // Actions
  const refresh = useCallback(() => {
    agentsStream.refresh();
    channelsStream.refresh();
    messagesStream.refresh();
    refreshCounts();
  }, [agentsStream, channelsStream, messagesStream, refreshCounts]);

  // Transcript counts
  const transcriptCounts = useMemo(
    () => ({
      lines: counts.transcriptLines,
      hookEvents: counts.hookEvents,
      sessions: counts.sessions,
    }),
    [counts.transcriptLines, counts.hookEvents, counts.sessions]
  );

  // Context value
  const value = useMemo<SignalDBContextValue>(
    () => ({
      configured,
      configLoading,
      apiHost,
      connected,
      agents: agentsStream.data,
      channels: channelsStream.data,
      messages: messagesStream.data,
      transcriptCounts,
      errors,
      refresh,
    }),
    [
      configured,
      configLoading,
      apiHost,
      connected,
      agentsStream.data,
      channelsStream.data,
      messagesStream.data,
      transcriptCounts,
      errors,
      refresh,
    ]
  );

  return (
    <SignalDBContext.Provider value={value}>
      {children}
    </SignalDBContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useSignalDB(): SignalDBContextValue {
  const context = useContext(SignalDBContext);
  if (!context) {
    throw new Error("useSignalDB must be used within a SignalDBProvider");
  }
  return context;
}
