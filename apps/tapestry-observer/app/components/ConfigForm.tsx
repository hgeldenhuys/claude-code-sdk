/**
 * ConfigForm Component
 *
 * Form to configure SignalDB connection credentials.
 */

import { useState } from "react";
import { useSignalDB } from "~/lib/signaldb";

export function ConfigForm() {
  const { setCredentials } = useSignalDB();
  const [apiUrl, setApiUrl] = useState("https://api.signaldb.live");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTesting(true);

    try {
      // Test the connection
      const response = await fetch(`${apiUrl}/v1/agents?limit=1`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid API key");
        }
        throw new Error(`Connection failed: ${response.statusText}`);
      }

      // Success - save credentials
      setCredentials(apiUrl, apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-100 mb-2">
            Tapestry Observer
          </h1>
          <p className="text-gray-500">
            Real-time COMMS monitoring for Claude Code agents
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* API URL */}
          <div>
            <label
              htmlFor="apiUrl"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              SignalDB API URL
            </label>
            <input
              id="apiUrl"
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.signaldb.live"
              className="
                w-full px-3 py-2 rounded-lg
                bg-gray-900 border border-gray-700
                text-gray-100 placeholder-gray-600
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              "
              required
            />
          </div>

          {/* API Key */}
          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Project API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_live_..."
              className="
                w-full px-3 py-2 rounded-lg
                bg-gray-900 border border-gray-700
                text-gray-100 placeholder-gray-600
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                font-mono
              "
              required
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={testing}
            className="
              w-full py-2 px-4 rounded-lg
              bg-blue-600 hover:bg-blue-700
              text-white font-medium
              transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {testing ? "Connecting..." : "Connect"}
          </button>
        </form>

        {/* Quick connect hint */}
        <p className="mt-6 text-center text-xs text-gray-600">
          Or append <code className="text-gray-500">?apiKey=sk_live_...</code>{" "}
          to the URL
        </p>
      </div>
    </div>
  );
}
