/**
 * Config Endpoint
 *
 * Returns proxy configuration status so the client can check
 * if the BFF proxy is ready. No secrets are exposed.
 *
 * Route: /api/config
 */

import type { LoaderFunctionArgs } from "react-router";
import { isProxyConfigured, getProxyApiUrl } from "./api.proxy.$";

export async function loader(_args: LoaderFunctionArgs) {
  const configured = await isProxyConfigured();
  const apiUrl = await getProxyApiUrl();

  // Mask the URL for display (show domain only)
  const maskedUrl = configured
    ? apiUrl.replace(/^https?:\/\//, "").split("/")[0]
    : null;

  return Response.json({
    configured,
    apiHost: maskedUrl,
  });
}
