/**
 * SignalDB Context Provider
 *
 * Provides SignalDB connection state and data to the component tree.
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
import { useAgents, useChannels, useMessages } from "./sse-hooks";
import type { Agent, Channel, ConnectionState, Message } from "./types";

// ============================================================================
// Context Types
// ============================================================================

interface SignalDBContextValue {
  // Connection
  apiUrl: string | null;
  apiKey: string | null;
  connected: ConnectionState;
  setCredentials: (apiUrl: string, apiKey: string) => void;
  clearCredentials: () => void;

  // Data
  agents: Agent[];
  channels: Channel[];
  messages: Message[];

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
// Credential Storage
// ============================================================================

const STORAGE_KEY_API_URL = "tapestry_api_url";
const STORAGE_KEY_API_KEY = "tapestry_api_key";

function getStoredCredentials(): { apiUrl: string | null; apiKey: string | null } {
  if (typeof window === "undefined") {
    return { apiUrl: null, apiKey: null };
  }
  return {
    apiUrl: localStorage.getItem(STORAGE_KEY_API_URL),
    apiKey: localStorage.getItem(STORAGE_KEY_API_KEY),
  };
}

function storeCredentials(apiUrl: string, apiKey: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_API_URL, apiUrl);
  localStorage.setItem(STORAGE_KEY_API_KEY, apiKey);
}

function clearStoredCredentials(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_API_URL);
  localStorage.removeItem(STORAGE_KEY_API_KEY);
}

// ============================================================================
// Provider Component
// ============================================================================

interface SignalDBProviderProps {
  children: ReactNode;
}

export function SignalDBProvider({ children }: SignalDBProviderProps) {
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Load credentials from URL params or storage on mount
  useEffect(() => {
    // Check URL params first
    const params = new URLSearchParams(window.location.search);
    const urlApiKey = params.get("apiKey");
    const urlApiUrl = params.get("apiUrl");

    if (urlApiKey) {
      const url = urlApiUrl || "https://api.signaldb.live";
      setApiUrl(url);
      setApiKey(urlApiKey);
      storeCredentials(url, urlApiKey);
      return;
    }

    // Fall back to stored credentials
    const stored = getStoredCredentials();
    if (stored.apiUrl && stored.apiKey) {
      setApiUrl(stored.apiUrl);
      setApiKey(stored.apiKey);
    }
  }, []);

  // SSE options
  const sseOptions = useMemo(
    () => ({
      apiUrl: apiUrl || "",
      apiKey: apiKey || "",
      enabled: !!(apiUrl && apiKey),
    }),
    [apiUrl, apiKey]
  );

  // Subscribe to all tables
  const agentsStream = useAgents(sseOptions);
  const channelsStream = useChannels(sseOptions);
  const messagesStream = useMessages(sseOptions);

  // Connection state
  const connected = useMemo<ConnectionState>(
    () => ({
      agents: agentsStream.connected,
      channels: channelsStream.connected,
      messages: messagesStream.connected,
    }),
    [agentsStream.connected, channelsStream.connected, messagesStream.connected]
  );

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
  const setCredentials = useCallback((url: string, key: string) => {
    setApiUrl(url);
    setApiKey(key);
    storeCredentials(url, key);
  }, []);

  const clearCredentials = useCallback(() => {
    setApiUrl(null);
    setApiKey(null);
    clearStoredCredentials();
  }, []);

  const refresh = useCallback(() => {
    agentsStream.refresh();
    channelsStream.refresh();
    messagesStream.refresh();
  }, [agentsStream, channelsStream, messagesStream]);

  // Context value
  const value = useMemo<SignalDBContextValue>(
    () => ({
      apiUrl,
      apiKey,
      connected,
      setCredentials,
      clearCredentials,
      agents: agentsStream.data,
      channels: channelsStream.data,
      messages: messagesStream.data,
      errors,
      refresh,
    }),
    [
      apiUrl,
      apiKey,
      connected,
      setCredentials,
      clearCredentials,
      agentsStream.data,
      channelsStream.data,
      messagesStream.data,
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
