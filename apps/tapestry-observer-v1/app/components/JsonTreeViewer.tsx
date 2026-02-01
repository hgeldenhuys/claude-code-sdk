/**
 * JsonTreeViewer Component
 *
 * Collapsible JSON tree viewer for hook event input/output.
 * Extends the flat JsonViewer with per-key collapsibility.
 */

import { useState } from "react";

interface JsonTreeViewerProps {
  data: unknown;
  label?: string;
  defaultExpanded?: boolean;
  maxDepth?: number;
}

export function JsonTreeViewer({
  data,
  label = "JSON",
  defaultExpanded = true,
  maxDepth = 4,
}: JsonTreeViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (data === null || data === undefined) {
    return <span className="text-gray-600 text-xs italic">null</span>;
  }

  const isObj = typeof data === "object";
  if (!isObj) {
    return <span className="text-xs font-mono text-gray-400">{String(data)}</span>;
  }

  const keys = Object.keys(data as object);
  if (keys.length === 0) {
    return (
      <span className="text-gray-600 text-xs font-mono">
        {Array.isArray(data) ? "[]" : "{}"}
      </span>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
      >
        <span className="font-mono">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>{label}</span>
        {!expanded && (
          <span className="text-gray-600 ml-1">
            ({keys.length} {Array.isArray(data) ? "items" : "keys"})
          </span>
        )}
      </button>
      {expanded && (
        <div className="ml-3 mt-1 border-l border-gray-800 pl-3">
          {keys.map((key) => {
            const val = (data as Record<string, unknown>)[key];
            return (
              <JsonTreeNode
                key={key}
                name={key}
                value={val}
                depth={1}
                maxDepth={maxDepth}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function JsonTreeNode({
  name,
  value,
  depth,
  maxDepth,
}: {
  name: string;
  value: unknown;
  depth: number;
  maxDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null || value === undefined) {
    return (
      <div className="flex items-baseline gap-1 text-xs py-0.5">
        <span className="text-gray-500 font-mono">{name}:</span>
        <span className="text-gray-600 italic">null</span>
      </div>
    );
  }

  if (typeof value !== "object") {
    const isStr = typeof value === "string";
    const isBool = typeof value === "boolean";
    const isNum = typeof value === "number";

    let colorClass = "text-gray-400";
    if (isStr) colorClass = "text-green-400";
    else if (isBool) colorClass = value ? "text-blue-400" : "text-red-400";
    else if (isNum) colorClass = "text-amber-400";

    const display = isStr
      ? `"${(value as string).length > 120 ? `${(value as string).slice(0, 120)}...` : value}"`
      : String(value);

    return (
      <div className="flex items-baseline gap-1 text-xs py-0.5">
        <span className="text-gray-500 font-mono">{name}:</span>
        <span className={`font-mono ${colorClass} break-all`}>{display}</span>
      </div>
    );
  }

  const keys = Object.keys(value as object);
  const isArray = Array.isArray(value);
  const summary = isArray ? `[${keys.length}]` : `{${keys.length}}`;

  if (depth >= maxDepth) {
    return (
      <div className="flex items-baseline gap-1 text-xs py-0.5">
        <span className="text-gray-500 font-mono">{name}:</span>
        <span className="text-gray-600 font-mono">{summary}</span>
      </div>
    );
  }

  return (
    <div className="text-xs py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-baseline gap-1 text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="font-mono">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="text-gray-500 font-mono">{name}:</span>
        {!expanded && <span className="text-gray-600 font-mono">{summary}</span>}
      </button>
      {expanded && (
        <div className="ml-3 border-l border-gray-800/50 pl-3">
          {keys.map((key) => (
            <JsonTreeNode
              key={key}
              name={key}
              value={(value as Record<string, unknown>)[key]}
              depth={depth + 1}
              maxDepth={maxDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}
