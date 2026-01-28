/**
 * Remote Client Facade
 *
 * Unified entry point for remote administration operations.
 * Composes ChannelClient, CommandExecutor, ReceiptTracker,
 * ResponseFormatter, and SecurityMiddleware into a single API.
 */

import { ChannelClient } from '../channels/channel-client';
import { SignalDBClient } from '../client/signaldb';
import { SecurityMiddleware } from '../security/middleware';
import { SecurityManager } from '../security/security-manager';
import { createDefaultSecurityConfig } from '../security/types';
import { CommandExecutor } from './command-executor';
import { CommandHandler } from './command-handler';
import { ReceiptTracker } from './receipt-tracker';
import { ResponseFormatter } from './response-formatter';
import { getTemplate } from './templates/index';
import type {
  ConfigParams,
  DeployParams,
  DiagnosticParams,
  RestartParams,
  StatusParams,
} from './templates/types';
import type { ExecutionReceipt, FormattedResponse, ReceiptFilter, RemoteConfig } from './types';

// ============================================================================
// Remote Client
// ============================================================================

/**
 * Unified facade for remote administration operations.
 *
 * Composes all remote components behind a clean API:
 * - **deploy**: Deploy applications via template
 * - **status**: Check application status
 * - **configUpdate**: Update environment variables
 * - **diagnostic**: Run system diagnostics
 * - **restart**: Restart applications
 * - **executeRaw**: Execute arbitrary commands
 * - **receipts**: Track and query execution receipts
 *
 * @example
 * ```typescript
 * const remote = new RemoteClient({
 *   apiUrl: 'https://signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 *   channelId: 'ch-commands',
 * });
 *
 * // Deploy an application
 * const receipt = await remote.deploy('agent-002', {
 *   app: 'my-api',
 *   branch: 'release/v2',
 * });
 *
 * // Wait for completion
 * const result = await remote.waitForCompletion(receipt.commandId, 60000);
 * console.log(result.output);
 *
 * // Check system diagnostics
 * const diag = await remote.diagnostic('agent-003', {
 *   checks: ['disk', 'memory'],
 * });
 * ```
 */
export class RemoteClient {
  private readonly channelClient: ChannelClient;
  private readonly executor: CommandExecutor;
  private readonly handler: CommandHandler;
  readonly receiptTracker: ReceiptTracker;

  constructor(config: RemoteConfig) {
    // Create channel client from config
    this.channelClient = new ChannelClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
      agentId: config.agentId,
    });

    // Create receipt tracker
    this.receiptTracker = new ReceiptTracker();

    // Create executor
    this.executor = new CommandExecutor(config, this.channelClient, this.receiptTracker);

    // Build or use provided security middleware
    let securityMiddleware: SecurityMiddleware;
    if (config.securityMiddleware) {
      securityMiddleware = config.securityMiddleware;
    } else {
      const restClient =
        config.signalDBClient ??
        new SignalDBClient({
          apiUrl: config.apiUrl,
          projectKey: config.projectKey,
        });
      const securityConfig =
        config.securityConfig ?? createDefaultSecurityConfig('remote-default-secret', []);
      const securityManager = new SecurityManager(securityConfig, restClient);
      securityMiddleware = new SecurityMiddleware(securityManager, config.agentId);
    }

    // Create handler
    this.handler = new CommandHandler(
      config,
      this.channelClient,
      this.receiptTracker,
      securityMiddleware
    );
  }

  // ==========================================================================
  // Template Commands
  // ==========================================================================

  /**
   * Deploy an application on a remote agent.
   */
  async deploy(targetAgent: string, params: DeployParams): Promise<ExecutionReceipt> {
    const template = getTemplate('deploy');
    return this.executor.execute(
      template,
      params as unknown as Record<string, unknown>,
      targetAgent
    );
  }

  /**
   * Check application status on a remote agent.
   */
  async status(targetAgent: string, params: StatusParams): Promise<ExecutionReceipt> {
    const template = getTemplate('status');
    return this.executor.execute(
      template,
      params as unknown as Record<string, unknown>,
      targetAgent
    );
  }

  /**
   * Update environment configuration on a remote agent.
   */
  async configUpdate(targetAgent: string, params: ConfigParams): Promise<ExecutionReceipt> {
    const template = getTemplate('config-update');
    return this.executor.execute(
      template,
      params as unknown as Record<string, unknown>,
      targetAgent
    );
  }

  /**
   * Run system diagnostics on a remote agent.
   */
  async diagnostic(targetAgent: string, params: DiagnosticParams): Promise<ExecutionReceipt> {
    const template = getTemplate('diagnostic');
    return this.executor.execute(
      template,
      params as unknown as Record<string, unknown>,
      targetAgent
    );
  }

  /**
   * Restart an application on a remote agent.
   */
  async restart(targetAgent: string, params: RestartParams): Promise<ExecutionReceipt> {
    const template = getTemplate('restart');
    return this.executor.execute(
      template,
      params as unknown as Record<string, unknown>,
      targetAgent
    );
  }

  // ==========================================================================
  // Raw Commands
  // ==========================================================================

  /**
   * Execute a raw shell command on a remote agent.
   */
  async executeRaw(targetAgent: string, command: string): Promise<ExecutionReceipt> {
    return this.executor.executeRaw(command, targetAgent);
  }

  // ==========================================================================
  // Receipt Management
  // ==========================================================================

  /**
   * Get a specific execution receipt.
   */
  getReceipt(commandId: string): ExecutionReceipt {
    return this.receiptTracker.get(commandId);
  }

  /**
   * List execution receipts with optional filtering.
   */
  listReceipts(filter?: ReceiptFilter): ExecutionReceipt[] {
    return this.receiptTracker.list(filter);
  }

  /**
   * Wait for a command to reach a terminal state (completed or failed).
   */
  async waitForCompletion(commandId: string, timeout?: number): Promise<ExecutionReceipt> {
    return this.executor.waitForReceipt(commandId, timeout);
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  /**
   * Format a receipt as a structured response.
   */
  formatReceipt(commandId: string): FormattedResponse {
    const receipt = this.receiptTracker.get(commandId);
    return ResponseFormatter.format(receipt);
  }

  /**
   * Format a receipt as CLI-friendly table output.
   */
  formatReceiptTable(commandId: string): string {
    const receipt = this.receiptTracker.get(commandId);
    const formatted = ResponseFormatter.format(receipt);
    return ResponseFormatter.toTable(formatted);
  }

  // ==========================================================================
  // Handler (Receiver-Side)
  // ==========================================================================

  /**
   * Start the command handler to receive and execute incoming commands.
   */
  startHandler(): void {
    this.handler.start();
  }

  /**
   * Stop the command handler.
   */
  stopHandler(): void {
    this.handler.stop();
  }

  /**
   * Disconnect the underlying channel client.
   */
  disconnect(): void {
    this.handler.stop();
    this.channelClient.disconnect();
  }
}
