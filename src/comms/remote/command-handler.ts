/**
 * Command Handler (Receiver-Side)
 *
 * Subscribes to command messages on a channel, validates them via
 * security middleware, executes them locally, and publishes results.
 */

import type { ChannelClient } from '../channels/channel-client';
import type { ChannelSubscription } from '../channels/types';
import type { Message } from '../protocol/types';
import type { SecurityMiddleware } from '../security/middleware';
import type { ReceiptTracker } from './receipt-tracker';
import type { CommandResult, RemoteConfig } from './types';

// ============================================================================
// Types
// ============================================================================

/** Custom handler function for specific command types */
type CustomHandler = (command: string, message: Message) => Promise<CommandResult>;

// ============================================================================
// Command Handler
// ============================================================================

/**
 * Receives and executes remote commands from a channel.
 *
 * Subscribes to a command channel, validates incoming commands via
 * security middleware, executes them locally using Bun.spawn, and
 * publishes results back to the channel as threaded responses.
 *
 * @example
 * ```typescript
 * const handler = new CommandHandler(config, channelClient, receiptTracker, securityMiddleware);
 *
 * // Register custom handler for specific command types
 * handler.registerHandler('deploy', async (cmd, msg) => {
 *   // custom deploy logic
 *   return { success: true, output: 'deployed', stderr: '', exitCode: 0, durationMs: 100, error: null };
 * });
 *
 * // Start listening for commands
 * handler.start();
 *
 * // Stop listening
 * handler.stop();
 * ```
 */
export class CommandHandler {
  private readonly config: RemoteConfig;
  private readonly channelClient: ChannelClient;
  private readonly receiptTracker: ReceiptTracker;
  private readonly securityMiddleware: SecurityMiddleware;
  private readonly customHandlers = new Map<string, CustomHandler>();
  private subscription: ChannelSubscription | null = null;

  constructor(
    config: RemoteConfig,
    channelClient: ChannelClient,
    receiptTracker: ReceiptTracker,
    securityMiddleware: SecurityMiddleware
  ) {
    this.config = config;
    this.channelClient = channelClient;
    this.receiptTracker = receiptTracker;
    this.securityMiddleware = securityMiddleware;
  }

  /**
   * Start listening for command messages on the configured channel.
   */
  start(): void {
    if (this.subscription) {
      return; // Already started
    }

    this.subscription = this.channelClient.subscribe(this.config.channelId, (message: Message) => {
      // Only process command messages
      if (message.messageType === 'command') {
        this.handleCommand(message).catch((err) => {
          console.error('[CommandHandler] Unhandled error:', err);
        });
      }
    });
  }

  /**
   * Stop listening for command messages.
   */
  stop(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Register a custom handler for a specific command type.
   *
   * @param commandType - The command type to handle
   * @param handler - The handler function
   */
  registerHandler(commandType: string, handler: CustomHandler): void {
    this.customHandlers.set(commandType, handler);
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  /**
   * Handle an incoming command message.
   */
  private async handleCommand(message: Message): Promise<void> {
    const metadata = message.metadata ?? {};
    const commandId = metadata.commandId as string | undefined;
    const command = message.content;
    const templateName = metadata.templateName as string | undefined;

    if (!commandId) {
      console.error('[CommandHandler] Message missing commandId in metadata');
      return;
    }

    try {
      // Create and acknowledge receipt
      this.receiptTracker.create(commandId, this.config.agentId, templateName);
      this.receiptTracker.acknowledge(commandId);

      // Security checks
      this.securityMiddleware.enforceDirectory(command);
      this.securityMiddleware.validateAndSanitize(command);

      // Transition to executing
      this.receiptTracker.executing(commandId);

      // Check for custom handler
      let result: CommandResult;
      const customHandler = templateName ? this.customHandlers.get(templateName) : null;

      if (customHandler) {
        result = await customHandler(command, message);
      } else {
        result = await this.executeLocally(command);
      }

      // Record result
      if (result.success) {
        this.receiptTracker.complete(commandId, result);
      } else {
        this.receiptTracker.fail(
          commandId,
          result.error ?? `Command failed with exit code ${result.exitCode}`
        );
      }

      // Send response
      await this.channelClient.publish(this.config.channelId, JSON.stringify(result), {
        messageType: 'response',
        threadId: message.id,
        metadata: {
          commandId,
          inReplyTo: message.id,
        },
      });

      // Audit log
      await this.securityMiddleware.audit({
        receiverId: this.config.agentId,
        command: `remote:execute:${templateName ?? 'raw'}`,
        result: result.success ? 'success' : 'failure',
        durationMs: result.durationMs,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Try to fail the receipt (may throw if not in valid state)
      try {
        this.receiptTracker.fail(commandId, errorMessage);
      } catch {
        // Receipt may already be in terminal state
      }

      // Send error response
      await this.channelClient.publish(
        this.config.channelId,
        JSON.stringify({ success: false, error: errorMessage }),
        {
          messageType: 'response',
          threadId: message.id,
          metadata: {
            commandId,
            inReplyTo: message.id,
          },
        }
      );

      // Audit the failure
      await this.securityMiddleware.audit({
        receiverId: this.config.agentId,
        command: `remote:execute:${templateName ?? 'raw'}`,
        result: 'failure',
        durationMs: 0,
      });
    }
  }

  /**
   * Execute a command locally using Bun.spawn.
   */
  private async executeLocally(command: string): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      const proc = Bun.spawn(['sh', '-c', command], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;
      const durationMs = Date.now() - startTime;

      return {
        success: exitCode === 0,
        output: stdout,
        stderr,
        exitCode,
        durationMs,
        error: exitCode !== 0 ? `Process exited with code ${exitCode}` : null,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        output: '',
        stderr: errorMessage,
        exitCode: 1,
        durationMs,
        error: errorMessage,
      };
    }
  }
}
