/**
 * CLI Bridge
 *
 * Barrel export for the unified comms CLI bridge.
 * Provides terminal-based access to the agent communication system.
 */

// Types
export type { CLICommand, EnvConfig, EnvConfigPartial } from './types';

// Utilities
export {
  bold,
  cyan,
  dim,
  exitWithError,
  formatStatus,
  formatTimestamp,
  getFlagValue,
  gray,
  green,
  hasJsonFlag,
  jsonOutput,
  magenta,
  parseEnvConfig,
  parseEnvConfigPartial,
  red,
  truncate,
  yellow,
} from './utils';

// Commands
export { execute as executeStatus } from './commands/status';
export { execute as executeAgents } from './commands/agents';
export { execute as executeSend } from './commands/send';
export { execute as executeListen } from './commands/listen';
export { execute as executeChannels } from './commands/channels';
export { execute as executeMemo } from './commands/memo';
export { execute as executePaste } from './commands/paste';
