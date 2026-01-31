/**
 * Content trimmer for transcript and hook event indexing.
 *
 * Deep-walks unknown JSON values and trims large string leaves to previews.
 * Full content remains accessible in original JSONL files via `file_path` + `line_number`.
 *
 * Design rules:
 * - TodoWrite and Task tool inputs are preserved in full (they carry semantics)
 * - `prompt` field values are never trimmed (user input must be searchable)
 * - Trimmed strings get suffix: ` [trimmed from N chars]`
 * - JSON structure is always preserved
 *
 * Mirrors: transcript-tui-rs/crates/transcript-indexer/src/content_trimmer.rs
 */

/** Maximum length of a trimmed preview */
const PREVIEW_LENGTH = 500;

/** Strings longer than this are candidates for trimming */
const LARGE_THRESHOLD = 1024;

/** Handler results use a higher threshold (they're usually small) */
const HANDLER_THRESHOLD = 4096;

/** Tools whose `input` should be preserved in full */
const FULL_PAYLOAD_TOOLS = new Set(['TodoWrite', 'Task']);

/** Field names whose string values should never be trimmed */
const FULL_PAYLOAD_FIELDS = new Set(['prompt']);

/**
 * Deep-walk an unknown value, trimming string leaves that exceed `threshold`.
 * Field names in FULL_PAYLOAD_FIELDS are never trimmed.
 * JSON structure (objects, arrays) is always preserved.
 */
function trimValue(value: unknown, threshold: number): unknown {
  if (typeof value === 'string') {
    if (value.length > threshold) {
      const preview = value.slice(0, PREVIEW_LENGTH);
      return `${preview} [trimmed from ${value.length} chars]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      result.push(trimValue(value[i], threshold));
    }
    return result;
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (FULL_PAYLOAD_FIELDS.has(key)) {
        // Never trim protected fields
        result[key] = obj[key];
      } else {
        result[key] = trimValue(obj[key], threshold);
      }
    }
    return result;
  }

  // Numbers, booleans, null pass through unchanged
  return value;
}

/**
 * Trim hook event `input` JSON.
 *
 * If `toolName` is in FULL_PAYLOAD_TOOLS, returns full serialization.
 * Otherwise deep-walks and trims large strings at LARGE_THRESHOLD.
 */
export function trimInputJson(input: Record<string, unknown>, toolName: string): string {
  if (FULL_PAYLOAD_TOOLS.has(toolName)) {
    return JSON.stringify(input);
  }
  return JSON.stringify(trimValue(input, LARGE_THRESHOLD));
}

/**
 * Trim hook event `context` JSON. Always trims large strings.
 */
export function trimContextJson(context: Record<string, unknown>): string {
  return JSON.stringify(trimValue(context, LARGE_THRESHOLD));
}

/**
 * Trim handler results JSON. Uses higher threshold (4KB) since handler
 * results are usually small structured data.
 */
export function trimHandlerResults(results: Record<string, unknown>): string {
  return JSON.stringify(trimValue(results, HANDLER_THRESHOLD));
}

/**
 * Trim a raw transcript JSONL line (parsed object).
 *
 * Deep-walks and trims large strings in message content, tool inputs, etc.
 * This is used for the `raw` column in the `lines` table.
 */
export function trimRawTranscriptLine(parsed: Record<string, unknown>): string {
  return JSON.stringify(trimValue(parsed, LARGE_THRESHOLD));
}
