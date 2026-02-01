/**
 * TranscriptLineRow Component
 *
 * Displays a single transcript line with type badge, timestamp, and content.
 * Used in session detail and search results.
 */

import {
  formatTime,
  getLineTypeBgColor,
  truncateContent,
  type TranscriptLine,
} from "~/lib/types";

interface TranscriptLineRowProps {
  line: TranscriptLine;
  highlight?: string;
  maxContentLength?: number;
  showSessionInfo?: boolean;
}

export function TranscriptLineRow({
  line,
  highlight,
  maxContentLength = 0,
  showSessionInfo = false,
}: TranscriptLineRowProps) {
  const content = maxContentLength > 0
    ? truncateContent(line.content, maxContentLength)
    : line.content || "";

  return (
    <div className="px-4 py-2 flex items-start gap-3 text-sm hover:bg-gray-800/30 transition-colors">
      {/* Line number */}
      <span className="text-xs text-gray-600 font-mono w-8 flex-shrink-0 text-right pt-0.5">
        {line.lineNumber}
      </span>

      {/* Timestamp */}
      <span className="text-xs text-gray-600 font-mono w-16 flex-shrink-0 pt-0.5">
        {formatTime(line.timestamp)}
      </span>

      {/* Type badge */}
      <span
        className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${getLineTypeBgColor(line.type)}`}
      >
        {line.type}
      </span>

      {/* Content */}
      <span className="text-gray-300 min-w-0 flex-1 whitespace-pre-wrap break-words">
        {highlight ? highlightText(content, highlight) : content}
      </span>

      {/* Optional session info */}
      {showSessionInfo && (
        <span className="text-xs text-gray-600 font-mono flex-shrink-0">
          {line.sessionName || line.sessionId.slice(0, 8)}
        </span>
      )}
    </div>
  );
}

function highlightText(text: string, query: string) {
  if (!query) return text;

  const parts: Array<{ text: string; match: boolean }> = [];
  const lower = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;

  let idx = lower.indexOf(lowerQuery);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push({ text: text.slice(lastIndex, idx), match: false });
    }
    parts.push({ text: text.slice(idx, idx + query.length), match: true });
    lastIndex = idx + query.length;
    idx = lower.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  if (parts.length === 0) return text;

  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="bg-yellow-700/50 text-yellow-200 rounded px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
