/**
 * Server-side SignalDB helpers for loaders
 *
 * Direct REST calls to SignalDB from server-side loaders,
 * bypassing the BFF proxy for SSR data fetching.
 * The API key is injected from environment — never reaches the browser.
 */

import { loadEnv, getApiCredentials } from "../routes/api.proxy.$";

export interface SignalDBResponse<T = unknown> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

/**
 * Fetch from SignalDB REST API (server-side only).
 * Accepts a path like "/v1/messages" and optional query params.
 * Returns the raw JSON response (typically { data: [...], meta: {...} }).
 */
export async function signalDBFetch<T = unknown>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const { apiUrl, apiKey } = await getApiCredentials();

  if (!apiKey) {
    throw new Error("SignalDB not configured: TAPESTRY_LIVE_PROJECT_KEY missing");
  }

  const url = new URL(path, apiUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`SignalDB ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
