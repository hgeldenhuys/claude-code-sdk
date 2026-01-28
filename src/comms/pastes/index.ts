/**
 * Paste System Exports
 *
 * Ephemeral content sharing with TTL and read-once semantics.
 */

// Types
export type {
  PasteContentType,
  PasteCompose,
  PasteView,
  PasteFilter,
  PasteConfig,
} from './types';

// Components
export { PasteManager, pasteToView } from './paste-manager';
export { PasteSharing } from './paste-sharing';

// Facade
export { PasteClient } from './paste-client';

// Secure wrapper
export { SecurePasteClient } from './secure-paste-client';
