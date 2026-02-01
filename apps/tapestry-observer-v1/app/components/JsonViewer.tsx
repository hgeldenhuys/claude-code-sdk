/**
 * JsonViewer Component
 *
 * Collapsible JSON display for metadata and capabilities.
 */

import { useState } from "react";

interface JsonViewerProps {
  data: unknown;
  label?: string;
  defaultExpanded?: boolean;
}

export function JsonViewer({
  data,
  label = "JSON",
  defaultExpanded = false,
}: JsonViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (data === null || data === undefined) {
    return (
      <span className="text-gray-600 text-xs italic">null</span>
    );
  }

  const isEmpty =
    typeof data === "object" && Object.keys(data as object).length === 0;

  if (isEmpty) {
    return (
      <span className="text-gray-600 text-xs font-mono">{"{}"}</span>
    );
  }

  const jsonStr = JSON.stringify(data, null, 2);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
      >
        <span className="font-mono">{expanded ? "▼" : "▶"}</span>
        <span>{label}</span>
        {!expanded && (
          <span className="text-gray-600 ml-1">
            ({Object.keys(data as object).length} keys)
          </span>
        )}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs font-mono text-gray-400 bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}
