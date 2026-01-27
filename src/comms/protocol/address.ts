/**
 * SignalDB Address Resolution
 *
 * Parses, validates, formats, and resolves agent communication addresses.
 *
 * URI formats:
 * - agent://machine-id/identifier
 * - project://machine-id/repo-path
 * - broadcast://channel-name
 */

import type { Address, AgentAddress, BroadcastAddress, ProjectAddress } from './types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Thrown when an address URI cannot be parsed.
 */
export class AddressParseError extends Error {
  readonly uri: string;

  constructor(uri: string, reason: string) {
    super(`Invalid address "${uri}": ${reason}`);
    this.name = 'AddressParseError';
    this.uri = uri;
  }
}

// ============================================================================
// Constants
// ============================================================================

const VALID_PROTOCOLS = new Set(['agent', 'project', 'broadcast']);

// ============================================================================
// Parse
// ============================================================================

/**
 * Parse an address URI string into a typed Address object.
 *
 * @param uri - Address URI (e.g. "agent://machine-123/session-456")
 * @returns Parsed Address with discriminated type field
 * @throws AddressParseError if the URI is malformed
 */
export function parseAddress(uri: string): Address {
  if (!uri || typeof uri !== 'string') {
    throw new AddressParseError(uri ?? '', 'Address must be a non-empty string');
  }

  const protocolEnd = uri.indexOf('://');
  if (protocolEnd === -1) {
    throw new AddressParseError(uri, 'Missing protocol separator "://"');
  }

  const protocol = uri.slice(0, protocolEnd);
  if (!VALID_PROTOCOLS.has(protocol)) {
    throw new AddressParseError(
      uri,
      `Unknown protocol "${protocol}". Expected: agent, project, or broadcast`
    );
  }

  const rest = uri.slice(protocolEnd + 3);
  if (!rest) {
    throw new AddressParseError(uri, 'Address body is empty after protocol');
  }

  switch (protocol) {
    case 'agent': {
      return parseAgentAddress(uri, rest);
    }
    case 'project': {
      return parseProjectAddress(uri, rest);
    }
    case 'broadcast': {
      return parseBroadcastAddress(uri, rest);
    }
    default: {
      throw new AddressParseError(uri, `Unhandled protocol "${protocol}"`);
    }
  }
}

function parseAgentAddress(uri: string, body: string): AgentAddress {
  const slashIdx = body.indexOf('/');
  if (slashIdx === -1 || slashIdx === 0) {
    throw new AddressParseError(
      uri,
      'Agent address requires format: agent://machine-id/identifier'
    );
  }

  const machineId = body.slice(0, slashIdx);
  const identifier = body.slice(slashIdx + 1);

  if (!machineId) {
    throw new AddressParseError(uri, 'Machine ID is empty');
  }
  if (!identifier) {
    throw new AddressParseError(uri, 'Agent identifier is empty');
  }

  return { type: 'agent', machineId, identifier };
}

function parseProjectAddress(uri: string, body: string): ProjectAddress {
  const slashIdx = body.indexOf('/');
  if (slashIdx === -1 || slashIdx === 0) {
    throw new AddressParseError(
      uri,
      'Project address requires format: project://machine-id/repo-path'
    );
  }

  const machineId = body.slice(0, slashIdx);
  const repoPath = body.slice(slashIdx + 1);

  if (!machineId) {
    throw new AddressParseError(uri, 'Machine ID is empty');
  }
  if (!repoPath) {
    throw new AddressParseError(uri, 'Repository path is empty');
  }

  return { type: 'project', machineId, repoPath };
}

function parseBroadcastAddress(uri: string, body: string): BroadcastAddress {
  // Broadcast doesn't use slashes in channel names, but strip leading slash if present
  const channelName = body.startsWith('/') ? body.slice(1) : body;

  if (!channelName) {
    throw new AddressParseError(uri, 'Broadcast channel name is empty');
  }

  return { type: 'broadcast', channelName };
}

// ============================================================================
// Format
// ============================================================================

/**
 * Serialize an Address object back to its URI string representation.
 *
 * @param addr - Typed Address object
 * @returns URI string (e.g. "agent://machine-123/session-456")
 */
export function formatAddress(addr: Address): string {
  switch (addr.type) {
    case 'agent':
      return `agent://${addr.machineId}/${addr.identifier}`;
    case 'project':
      return `project://${addr.machineId}/${addr.repoPath}`;
    case 'broadcast':
      return `broadcast://${addr.channelName}`;
  }
}

// ============================================================================
// Validate
// ============================================================================

/**
 * Check whether a URI string is a valid SignalDB address.
 *
 * @param uri - Address URI to validate
 * @returns true if the URI can be parsed without errors
 */
export function validateAddress(uri: string): boolean {
  try {
    parseAddress(uri);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Resolve
// ============================================================================

/**
 * Extract query-ready fields from an AgentAddress.
 *
 * @param addr - Agent address to resolve
 * @returns Object with machineId and identifier for database queries
 */
export function resolveAgentAddress(addr: AgentAddress): { machineId: string; identifier: string } {
  return {
    machineId: addr.machineId,
    identifier: addr.identifier,
  };
}
