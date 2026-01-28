/**
 * Command Templates
 *
 * Barrel exports and factory function for all command templates.
 */

import type { RemoteCommandType } from '../types';
import { ConfigTemplate } from './config-update';
import { DeployTemplate } from './deploy';
import { DiagnosticTemplate } from './diagnostic';
import { RestartTemplate } from './restart';
import { StatusTemplate } from './status';
import type { CommandTemplate } from './types';

// Types
export type {
  CommandTemplate,
  DeployParams,
  StatusParams,
  ConfigParams,
  DiagnosticParams,
  RestartParams,
} from './types';

// Template classes
export { DeployTemplate } from './deploy';
export { StatusTemplate } from './status';
export { ConfigTemplate } from './config-update';
export { DiagnosticTemplate } from './diagnostic';
export { RestartTemplate } from './restart';

// ============================================================================
// Template Factory
// ============================================================================

/** Cached template instances */
const templates: Record<string, CommandTemplate> = {
  deploy: new DeployTemplate(),
  status: new StatusTemplate(),
  'config-update': new ConfigTemplate(),
  diagnostic: new DiagnosticTemplate(),
  restart: new RestartTemplate(),
};

/**
 * Get a command template by type.
 *
 * @param name - The command type (deploy, status, config-update, diagnostic, restart)
 * @returns The matching CommandTemplate
 * @throws Error if no template exists for the given type
 */
export function getTemplate(name: RemoteCommandType): CommandTemplate {
  const template = templates[name];
  if (!template) {
    throw new Error(`No template found for command type: ${name}`);
  }
  return template;
}
