/**
 * API Proxy Route
 *
 * Proxies requests to SignalDB API to avoid CORS issues.
 * Route: /api/proxy/* -> https://api.signaldb.live/*
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

const SIGNALDB_API_URL = "https://api.signaldb.live";

async function proxyRequest(request: Request, params: { "*": string }) {
  const path = params["*"] || "";
  const url = new URL(request.url);
  const targetUrl = `${SIGNALDB_API_URL}/${path}${url.search}`;

  // Forward the request with same method, headers, and body
  const headers = new Headers();

  // Copy relevant headers
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }
  headers.set("Content-Type", "application/json");
  headers.set("Accept", request.headers.get("Accept") || "application/json");

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

    // Return proxied response with CORS headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

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

// Handle OPTIONS preflight
export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return proxyRequest(request, params as { "*": string });
}

// Handle POST, PUT, DELETE
export async function action({ request, params }: ActionFunctionArgs) {
  return proxyRequest(request, params as { "*": string });
}
