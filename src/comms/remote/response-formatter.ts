/**
 * Response Formatter
 *
 * Formats execution receipts into human-readable responses
 * for display in CLI, JSON, or table format.
 */

import type { ExecutionReceipt, FormattedResponse } from './types';

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats execution receipts into structured, human-readable responses.
 *
 * @example
 * ```typescript
 * const receipt = receiptTracker.get('cmd-1');
 * const response = ResponseFormatter.format(receipt);
 *
 * // JSON output
 * console.log(ResponseFormatter.toJSON(response));
 *
 * // CLI table output
 * console.log(ResponseFormatter.toTable(response));
 * ```
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Facade class per module design pattern
export class ResponseFormatter {
  /**
   * Format a single execution receipt into a FormattedResponse.
   */
  static format(receipt: ExecutionReceipt): FormattedResponse {
    const totalDurationMs = ResponseFormatter.calculateTotalDuration(receipt);
    const executionDurationMs = ResponseFormatter.calculateExecDuration(receipt);

    return {
      success: receipt.status === 'completed',
      status: receipt.status === 'completed' ? 'completed' : 'failed',
      commandId: receipt.commandId,
      templateName: receipt.templateName,
      timing: {
        sentAt: receipt.sentAt,
        acknowledgedAt: receipt.acknowledgedAt,
        executingAt: receipt.executingAt,
        completedAt: receipt.completedAt,
        totalDurationMs,
        executionDurationMs,
      },
      output: ResponseFormatter.truncate(receipt.output),
      stderr: ResponseFormatter.truncate(receipt.stderr),
      exitCode: receipt.exitCode,
      error: receipt.error,
    };
  }

  /**
   * Format multiple receipts into FormattedResponse array.
   */
  static formatBatch(receipts: ExecutionReceipt[]): FormattedResponse[] {
    const results: FormattedResponse[] = [];
    for (let i = 0; i < receipts.length; i++) {
      results.push(ResponseFormatter.format(receipts[i]!));
    }
    return results;
  }

  /**
   * Truncate text to a maximum length, appending indicator if truncated.
   *
   * @param text - Text to truncate (null passes through)
   * @param maxLength - Maximum length before truncation (default: 500)
   */
  static truncate(text: string | null, maxLength = 500): string | null {
    if (text === null) return null;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...[truncated]`;
  }

  /**
   * Convert a FormattedResponse to a JSON string.
   */
  static toJSON(response: FormattedResponse): string {
    return JSON.stringify(response, null, 2);
  }

  /**
   * Convert a FormattedResponse to a CLI-friendly table string.
   */
  static toTable(response: FormattedResponse): string {
    const statusLabel = response.success
      ? `${response.status} (success)`
      : `${response.status} (failure)`;

    const durationLabel =
      response.timing.totalDurationMs !== null
        ? `${response.timing.totalDurationMs}ms${
            response.timing.executionDurationMs !== null
              ? ` (exec: ${response.timing.executionDurationMs}ms)`
              : ''
          }`
        : 'N/A';

    const lines = [
      `Command:    ${response.commandId}`,
      `Template:   ${response.templateName ?? 'raw'}`,
      `Status:     ${statusLabel}`,
      `Duration:   ${durationLabel}`,
      `Exit Code:  ${response.exitCode ?? 'N/A'}`,
    ];

    if (response.output) {
      lines.push(`Output:     ${response.output}`);
    }

    if (response.stderr) {
      lines.push(`Stderr:     ${response.stderr}`);
    }

    if (response.error) {
      lines.push(`Error:      ${response.error}`);
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private static calculateTotalDuration(receipt: ExecutionReceipt): number | null {
    const endTime = receipt.completedAt ?? receipt.failedAt;
    if (!endTime) return null;
    return new Date(endTime).getTime() - new Date(receipt.sentAt).getTime();
  }

  private static calculateExecDuration(receipt: ExecutionReceipt): number | null {
    if (!receipt.executingAt) return null;
    const endTime = receipt.completedAt ?? receipt.failedAt;
    if (!endTime) return null;
    return new Date(endTime).getTime() - new Date(receipt.executingAt).getTime();
  }
}
