/**
 * Remote Administration Module
 *
 * Provides remote command execution, receipt tracking, and
 * command templates for managing agents on remote servers.
 *
 * @example
 * ```typescript
 * import {
 *   RemoteClient,
 *   getTemplate,
 *   ResponseFormatter,
 * } from 'claude-code-sdk/comms';
 *
 * const remote = new RemoteClient({
 *   apiUrl: 'https://signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 *   channelId: 'ch-commands',
 * });
 *
 * const receipt = await remote.deploy('agent-002', {
 *   app: 'my-api',
 *   branch: 'main',
 * });
 * ```
 */

// Core types
export type {
  RemoteCommandType,
  ReceiptStatus,
  RemoteCommand,
  ExecutionReceipt,
  CommandResult,
  RemoteConfig,
  ReceiptFilter,
  ReceiptCallback,
  FormattedResponse,
} from './types';

// Template types
export type {
  CommandTemplate,
  DeployParams,
  StatusParams,
  ConfigParams,
  DiagnosticParams,
  RestartParams,
} from './templates/index';

// Template classes and factory
export {
  DeployTemplate,
  StatusTemplate,
  ConfigTemplate,
  DiagnosticTemplate,
  RestartTemplate,
  getTemplate,
} from './templates/index';

// Receipt tracking
export { ReceiptTracker } from './receipt-tracker';

// Command execution
export { CommandExecutor } from './command-executor';
export { CommandHandler } from './command-handler';

// Response formatting
export { ResponseFormatter } from './response-formatter';

// Facade
export { RemoteClient } from './remote-client';
