/**
 * SignalDB Protocol Exports
 *
 * Types, address resolution, and presence derivation.
 */

// Types
export type {
  AgentStatus,
  ChannelType,
  MessageType,
  MessageStatus,
  AccessType,
  AgentAddress,
  ProjectAddress,
  BroadcastAddress,
  Address,
  Agent,
  Channel,
  Message,
  Paste,
  AgentRegistration,
  ChannelCreate,
  MessageSend,
  PasteCreate,
  AgentFilter,
  ChannelFilter,
  MessageFilter,
} from './types';

// Address resolution
export {
  parseAddress,
  formatAddress,
  validateAddress,
  resolveAgentAddress,
  AddressParseError,
} from './address';

// Presence derivation
export {
  derivePresence,
  isActive,
  isIdle,
  isOffline,
  getPresenceThresholds,
} from './presence';
