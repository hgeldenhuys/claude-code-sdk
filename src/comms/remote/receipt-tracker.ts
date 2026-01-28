/**
 * Execution Receipt Tracker
 *
 * Tracks the lifecycle of remote command executions via a state machine.
 * Stores receipts in memory and enforces valid state transitions.
 */

import type {
  CommandResult,
  ExecutionReceipt,
  ReceiptCallback,
  ReceiptFilter,
  ReceiptStatus,
} from './types';

// ============================================================================
// State Machine
// ============================================================================

/** Valid state transitions for receipt status */
const VALID_TRANSITIONS: Record<ReceiptStatus, ReceiptStatus[]> = {
  command_sent: ['acknowledged', 'failed'],
  acknowledged: ['executing', 'failed'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: [],
};

/**
 * Assert a state transition is valid.
 *
 * @param current - Current receipt status
 * @param target - Desired target status
 * @throws Error if the transition is not allowed
 */
function assertTransition(current: ReceiptStatus, target: ReceiptStatus): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new Error(
      `Invalid receipt transition: "${current}" -> "${target}". ` +
        `Valid transitions from "${current}": [${(allowed ?? []).join(', ')}]`
    );
  }
}

// ============================================================================
// Receipt Tracker
// ============================================================================

/**
 * Tracks execution receipts for remote commands.
 *
 * Provides state machine enforcement ensuring receipts follow a valid
 * lifecycle: command_sent -> acknowledged -> executing -> completed | failed.
 *
 * @example
 * ```typescript
 * const tracker = new ReceiptTracker();
 * tracker.onTransition = (receipt) => console.log(receipt.status);
 *
 * const receipt = tracker.create('cmd-1', 'agent-002', 'deploy');
 * tracker.acknowledge('cmd-1');
 * tracker.executing('cmd-1');
 * tracker.complete('cmd-1', { success: true, output: 'OK', ... });
 * ```
 */
export class ReceiptTracker {
  private readonly receipts = new Map<string, ExecutionReceipt>();
  private transitionCallback: ReceiptCallback | null = null;

  /**
   * Set a callback invoked on every status transition.
   */
  set onTransition(callback: ReceiptCallback) {
    this.transitionCallback = callback;
  }

  /**
   * Create a new receipt for a command.
   *
   * @param commandId - Unique command identifier
   * @param targetAgent - Agent that will execute the command
   * @param templateName - Optional template name (null for raw commands)
   * @returns The created ExecutionReceipt
   */
  create(commandId: string, targetAgent: string, templateName?: string): ExecutionReceipt {
    const receipt: ExecutionReceipt = {
      commandId,
      targetAgent,
      status: 'command_sent',
      sentAt: new Date().toISOString(),
      acknowledgedAt: null,
      executingAt: null,
      completedAt: null,
      failedAt: null,
      output: null,
      stderr: null,
      exitCode: null,
      error: null,
      templateName: templateName ?? null,
      metadata: {},
    };

    this.receipts.set(commandId, receipt);
    this.notify(receipt);
    return receipt;
  }

  /**
   * Transition receipt to acknowledged status.
   *
   * @param commandId - Command identifier
   * @throws Error if receipt not found or transition is invalid
   */
  acknowledge(commandId: string): ExecutionReceipt {
    const receipt = this.getOrThrow(commandId);
    assertTransition(receipt.status, 'acknowledged');

    receipt.status = 'acknowledged';
    receipt.acknowledgedAt = new Date().toISOString();
    this.notify(receipt);
    return receipt;
  }

  /**
   * Transition receipt to executing status.
   *
   * @param commandId - Command identifier
   * @throws Error if receipt not found or transition is invalid
   */
  executing(commandId: string): ExecutionReceipt {
    const receipt = this.getOrThrow(commandId);
    assertTransition(receipt.status, 'executing');

    receipt.status = 'executing';
    receipt.executingAt = new Date().toISOString();
    this.notify(receipt);
    return receipt;
  }

  /**
   * Transition receipt to completed status with execution results.
   *
   * @param commandId - Command identifier
   * @param result - Execution result data
   * @throws Error if receipt not found or transition is invalid
   */
  complete(commandId: string, result: CommandResult): ExecutionReceipt {
    const receipt = this.getOrThrow(commandId);
    assertTransition(receipt.status, 'completed');

    receipt.status = 'completed';
    receipt.completedAt = new Date().toISOString();
    receipt.output = result.output;
    receipt.stderr = result.stderr;
    receipt.exitCode = result.exitCode;
    receipt.error = result.error;
    this.notify(receipt);
    return receipt;
  }

  /**
   * Transition receipt to failed status.
   * Valid from command_sent, acknowledged, or executing (any non-terminal state).
   *
   * @param commandId - Command identifier
   * @param error - Error message describing the failure
   * @throws Error if receipt not found or transition is invalid
   */
  fail(commandId: string, error: string): ExecutionReceipt {
    const receipt = this.getOrThrow(commandId);
    assertTransition(receipt.status, 'failed');

    receipt.status = 'failed';
    receipt.failedAt = new Date().toISOString();
    receipt.error = error;
    this.notify(receipt);
    return receipt;
  }

  /**
   * Get a receipt by command ID.
   *
   * @param commandId - Command identifier
   * @returns The ExecutionReceipt
   * @throws Error if receipt not found
   */
  get(commandId: string): ExecutionReceipt {
    return this.getOrThrow(commandId);
  }

  /**
   * List receipts with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching receipts
   */
  list(filter?: ReceiptFilter): ExecutionReceipt[] {
    const results: ExecutionReceipt[] = [];
    const entries = Array.from(this.receipts.values());

    for (let i = 0; i < entries.length; i++) {
      const receipt = entries[i]!;
      if (filter) {
        if (filter.status && receipt.status !== filter.status) continue;
        if (filter.targetAgent && receipt.targetAgent !== filter.targetAgent) continue;
        if (filter.templateName && receipt.templateName !== filter.templateName) continue;
      }
      results.push(receipt);
    }

    return results;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getOrThrow(commandId: string): ExecutionReceipt {
    const receipt = this.receipts.get(commandId);
    if (!receipt) {
      throw new Error(`Receipt not found for command: ${commandId}`);
    }
    return receipt;
  }

  private notify(receipt: ExecutionReceipt): void {
    if (this.transitionCallback) {
      this.transitionCallback(receipt);
    }
  }
}
