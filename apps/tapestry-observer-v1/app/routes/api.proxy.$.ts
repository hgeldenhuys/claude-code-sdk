/**
 * BFF Proxy Route
 *
 * Proxies requests to SignalDB API with server-side credential injection.
 * The API key never reaches the browser — it's loaded from environment
 * variables and injected into every outbound request.
 *
 * Route: /api/proxy/* -> SignalDB API
 *
 * Environment variables (loaded via vite.config.ts envDir pointing to project root):
 *   TAPESTRY_LIVE_API_URL  - SignalDB API base URL
 *   TAPESTRY_LIVE_PROJECT_KEY - API key for authentication
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

// Lazy-loaded env config (populated on first request, server-side only)
let _apiUrl: string | null = null;
let _apiKey: string | null = null;
let _loaded = false;

async function loadEnv() {
  if (_loaded) return;
  _loaded = true;

  // In SSR context, process.env is available
  _apiUrl = process.env.TAPESTRY_LIVE_API_URL || "https://api.signaldb.live";
  _apiKey = process.env.TAPESTRY_LIVE_PROJECT_KEY || "";

  // If not found in process.env, try reading .env.tapestry directly
  if (!_apiKey) {
    try {
      const { readFileSync } = await import("fs");
      const { resolve } = await import("path");

      // Try multiple paths
      const paths = [
        resolve(process.cwd(), "../../.env.tapestry"),
        resolve(process.cwd(), ".env.tapestry"),
      ];

      for (const envPath of paths) {
        try {
          const content = readFileSync(envPath, "utf-8");
          const lines = content.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
            const eqIdx = trimmed.indexOf("=");
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (key === "TAPESTRY_LIVE_API_URL" && value) {
              _apiUrl = value;
            }
            if (key === "TAPESTRY_LIVE_PROJECT_KEY" && value) {
              _apiKey = value;
            }
          }
          if (_apiKey) break;
        } catch {
          // File not found at this path, try next
        }
      }
    } catch {
      // fs/path not available (shouldn't happen in SSR)
    }
  }
}

/** Check if the proxy is configured with valid credentials */
export async function isProxyConfigured(): Promise<boolean> {
  await loadEnv();
  return (_apiKey ?? "").length > 0;
}

/** Get the configured API URL (for the config endpoint) */
export async function getProxyApiUrl(): Promise<string> {
  await loadEnv();
  return _apiUrl || "https://api.signaldb.live";
}

async function proxyRequest(request: Request, params: { "*": string }) {
  await loadEnv();

  if (!_apiKey) {
    return new Response(
      JSON.stringify({
        error: "Proxy not configured",
        message: "Server missing TAPESTRY_LIVE_PROJECT_KEY in .env.tapestry",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const path = params["*"] || "";
  const url = new URL(request.url);
  const targetUrl = `${_apiUrl}/${path}${url.search}`;

  // Build headers — always inject server-side auth, strip any client-sent auth
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${_apiKey}`);
  headers.set("Content-Type", request.headers.get("Content-Type") || "application/json");

  // For SSE streams, forward the Accept header
  const acceptHeader = request.headers.get("Accept");
  if (acceptHeader) {
    headers.set("Accept", acceptHeader);
  } else {
    headers.set("Accept", "application/json");
  }

  // Forward Last-Event-ID for SSE reconnection
  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId) {
    headers.set("Last-Event-ID", lastEventId);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  // Forward body for POST/PUT/PATCH
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    try {
      init.body = await request.text();
    } catch {
      // No body
    }
  }

  try {
    const response = await fetch(targetUrl, init);

    // Check if this is an SSE stream response
    const contentType = response.headers.get("Content-Type") || "";
    const isSSE = contentType.includes("text/event-stream");

    if (isSSE && response.body) {
      // Stream SSE directly — pipe the response body through
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-SSE: return proxied response
    const responseHeaders = new Headers();
    responseHeaders.set(
      "Content-Type",
      response.headers.get("Content-Type") || "application/json"
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Proxy error", message: String(error) }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Handle GET (including SSE streams)
export async function loader({ request, params }: LoaderFunctionArgs) {
  return proxyRequest(request, params as { "*": string });
}

// Handle POST, PUT, DELETE
export async function action({ request, params }: ActionFunctionArgs) {
  return proxyRequest(request, params as { "*": string });
}
