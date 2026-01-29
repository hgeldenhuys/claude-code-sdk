/**
 * Tapestry Configuration Exports
 *
 * Multi-environment configuration for SignalDB projects.
 */

export {
  // Types
  type TapestryEnvironment,
  type EnvironmentConfig,
  type TapestryConfig,
  type EnvironmentInfo,
  // Error
  EnvironmentConfigError,
  // Functions
  loadTapestryConfig,
  getEnvironmentConfig,
  getCurrentEnvironmentConfig,
  toSignalDBConfig,
  toDaemonConfig,
  listConfiguredEnvironments,
  validateEnvironments,
  getEnvironmentInfo,
} from './environments';
