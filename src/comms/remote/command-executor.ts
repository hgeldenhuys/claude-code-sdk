/**
 * Command Executor (Sender-Side)
 *
 * Sends remote commands via channel messaging and tracks their
 * execution receipts. Supports both template-based and raw commands.
 */

import type { ChannelClient } from '../channels/channel-client';
import type { ReceiptTracker } from './receipt-tracker';
import type { CommandTemplate } from './templates/types';
import type { ExecutionReceipt, RemoteConfig } from './types';

// ============================================================================
// Command Executor
// ============================================================================

/**
 * Sends commands to remote agents via channel messaging.
 *
 * @example
 * ```typescript
 * const executor = new CommandExecutor(config, channelClient, receiptTracker);
 *
 * // Template-based command
 * const template = getTemplate('deploy');
 * const receipt = await executor.execute(template, { app: 'my-app' }, 'agent-002');
 *
 * // Raw command
 * const rawReceipt = await executor.executeRaw('ls -la /app', 'agent-002');
 *
 * // Wait for completion
 * const result = await executor.waitForReceipt(rawReceipt.commandId, 30000);
 * ```
 */
export class CommandExecutor {
  private readonly config: RemoteConfig;
  private readonly channelClient: ChannelClient;
  private readonly receiptTracker: ReceiptTracker;

  constructor(config: RemoteConfig, channelClient: ChannelClient, receiptTracker: ReceiptTracker) {
    this.config = config;
    this.channelClient = channelClient;
    this.receiptTracker = receiptTracker;
  }

  /**
   * Execute a template-based command on a remote agent.
   *
   * @param template - The command template to use
   * @param params - Template parameters
   * @param targetAgent - Agent ID to execute the command
   * @returns The created ExecutionReceipt
   */
  async execute(
    template: CommandTemplate,
    params: Record<string, unknown>,
    targetAgent: string
  ): Promise<ExecutionReceipt> {
    // Validate parameters
    template.validateParams(params);

    // Build the command string
    const command = template.buildCommand(params);

    // Generate unique command ID
    const commandId = crypto.randomUUID();

    // Create receipt
    const receipt = this.receiptTracker.create(commandId, targetAgent, template.name);

    // Publish command to channel
    await this.channelClient.publish(this.config.channelId, command, {
      messageType: 'command',
      metadata: {
        commandId,
        templateName: template.name,
        timeout: this.config.defaultTimeout ?? 300000,
      },
    });

    return receipt;
  }

  /**
   * Execute a raw shell command on a remote agent.
   *
   * @param command - The shell command to execute
   * @param targetAgent - Agent ID to execute the command
   * @returns The created ExecutionReceipt
   */
  async executeRaw(command: string, targetAgent: string): Promise<ExecutionReceipt> {
    const commandId = crypto.randomUUID();

    // Create receipt for raw command
    const receipt = this.receiptTracker.create(commandId, targetAgent, 'raw');

    // Publish command to channel
    await this.channelClient.publish(this.config.channelId, command, {
      messageType: 'command',
      metadata: {
        commandId,
        templateName: 'raw',
        timeout: this.config.defaultTimeout ?? 300000,
      },
    });

    return receipt;
  }

  /**
   * Wait for a receipt to reach a terminal state (completed or failed).
   * Polls the receipt tracker every 500ms.
   *
   * @param commandId - The command to wait for
   * @param timeout - Maximum time to wait in ms (default: config.defaultTimeout)
   * @returns The terminal ExecutionReceipt
   * @throws Error on timeout
   */
  async waitForReceipt(commandId: string, timeout?: number): Promise<ExecutionReceipt> {
    const maxWait = timeout ?? this.config.defaultTimeout ?? 300000;
    const startTime = Date.now();

    return new Promise<ExecutionReceipt>((resolve, reject) => {
      const poll = () => {
        try {
          const receipt = this.receiptTracker.get(commandId);

          if (receipt.status === 'completed' || receipt.status === 'failed') {
            resolve(receipt);
            return;
          }

          if (Date.now() - startTime >= maxWait) {
            reject(new Error(`Timeout waiting for receipt ${commandId} after ${maxWait}ms`));
            return;
          }

          setTimeout(poll, 500);
        } catch (err) {
          reject(err);
        }
      };

      poll();
    });
  }
}
