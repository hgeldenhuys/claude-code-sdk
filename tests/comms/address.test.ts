/**
 * Tests for SignalDB Address Resolution
 *
 * Covers: parseAddress, formatAddress, validateAddress, resolveAgentAddress, AddressParseError
 */

import { describe, test, expect } from 'bun:test';
import {
  parseAddress,
  formatAddress,
  validateAddress,
  resolveAgentAddress,
  AddressParseError,
} from '../../src/comms/protocol/address';
import type { AgentAddress, ProjectAddress, BroadcastAddress } from '../../src/comms/protocol/types';

// ============================================================================
// parseAddress
// ============================================================================

describe('parseAddress', () => {
  describe('agent:// addresses', () => {
    test('parses agent://machine-123/session-456', () => {
      const result = parseAddress('agent://machine-123/session-456');
      expect(result.type).toBe('agent');
      const agentAddr = result as AgentAddress;
      expect(agentAddr.machineId).toBe('machine-123');
      expect(agentAddr.identifier).toBe('session-456');
    });

    test('parses agent address with session name identifier', () => {
      const result = parseAddress('agent://machine-123/my-session-name');
      expect(result.type).toBe('agent');
      const agentAddr = result as AgentAddress;
      expect(agentAddr.machineId).toBe('machine-123');
      expect(agentAddr.identifier).toBe('my-session-name');
    });

    test('parses agent address with UUID-style identifiers', () => {
      const result = parseAddress('agent://abc-def-123/550e8400-e29b-41d4-a716-446655440000');
      expect(result.type).toBe('agent');
      const agentAddr = result as AgentAddress;
      expect(agentAddr.machineId).toBe('abc-def-123');
      expect(agentAddr.identifier).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('project:// addresses', () => {
    test('parses project://machine-123/path/to/repo', () => {
      const result = parseAddress('project://machine-123/path/to/repo');
      expect(result.type).toBe('project');
      const projAddr = result as ProjectAddress;
      expect(projAddr.machineId).toBe('machine-123');
      expect(projAddr.repoPath).toBe('path/to/repo');
    });

    test('parses project address with deep path', () => {
      const result = parseAddress('project://mac-001/Users/dev/projects/my-app');
      expect(result.type).toBe('project');
      const projAddr = result as ProjectAddress;
      expect(projAddr.machineId).toBe('mac-001');
      expect(projAddr.repoPath).toBe('Users/dev/projects/my-app');
    });
  });

  describe('broadcast:// addresses', () => {
    test('parses broadcast://general-channel', () => {
      const result = parseAddress('broadcast://general-channel');
      expect(result.type).toBe('broadcast');
      const bcastAddr = result as BroadcastAddress;
      expect(bcastAddr.channelName).toBe('general-channel');
    });

    test('strips leading slash from broadcast channel name', () => {
      const result = parseAddress('broadcast:///leading-slash');
      expect(result.type).toBe('broadcast');
      const bcastAddr = result as BroadcastAddress;
      expect(bcastAddr.channelName).toBe('leading-slash');
    });
  });

  describe('error cases', () => {
    test('throws AddressParseError for empty string', () => {
      expect(() => parseAddress('')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for missing protocol', () => {
      expect(() => parseAddress('machine-123/session-456')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for unknown protocol (http://)', () => {
      expect(() => parseAddress('http://example.com')).toThrow(AddressParseError);
      try {
        parseAddress('http://example.com');
      } catch (e) {
        expect(e).toBeInstanceOf(AddressParseError);
        const err = e as AddressParseError;
        expect(err.uri).toBe('http://example.com');
        expect(err.message).toContain('Unknown protocol');
      }
    });

    test('throws AddressParseError for unknown protocol (ftp://)', () => {
      expect(() => parseAddress('ftp://files/data')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for agent:// without path segments', () => {
      // "agent://machine-only" has no slash after the body
      expect(() => parseAddress('agent://machine-only')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for agent:// with empty identifier', () => {
      // "agent://machine/" has empty identifier
      expect(() => parseAddress('agent://machine/')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for project:// without path segments', () => {
      expect(() => parseAddress('project://machine-only')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for empty body after protocol', () => {
      expect(() => parseAddress('agent://')).toThrow(AddressParseError);
    });

    test('throws AddressParseError for broadcast:// with empty channel after strip', () => {
      expect(() => parseAddress('broadcast://')).toThrow(AddressParseError);
    });

    test('AddressParseError has correct uri property', () => {
      const badUri = 'bad-uri-no-protocol';
      try {
        parseAddress(badUri);
        // Should not reach here
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(AddressParseError);
        expect((e as AddressParseError).uri).toBe(badUri);
      }
    });

    test('AddressParseError has correct name property', () => {
      try {
        parseAddress('');
      } catch (e) {
        expect((e as AddressParseError).name).toBe('AddressParseError');
      }
    });
  });

  describe('edge cases', () => {
    test('handles extra slashes in project repo path', () => {
      // project://machine/a/b/c/d should capture full path after first slash
      const result = parseAddress('project://machine/a/b/c/d');
      expect(result.type).toBe('project');
      const projAddr = result as ProjectAddress;
      expect(projAddr.machineId).toBe('machine');
      expect(projAddr.repoPath).toBe('a/b/c/d');
    });

    test('handles unicode in agent identifier', () => {
      const result = parseAddress('agent://machine-1/session-unicode');
      expect(result.type).toBe('agent');
      const agentAddr = result as AgentAddress;
      expect(agentAddr.identifier).toBe('session-unicode');
    });

    test('handles unicode in broadcast channel name', () => {
      const result = parseAddress('broadcast://test-channel');
      expect(result.type).toBe('broadcast');
      const bcastAddr = result as BroadcastAddress;
      expect(bcastAddr.channelName).toBe('test-channel');
    });

    test('handles agent address with dots and underscores', () => {
      const result = parseAddress('agent://machine.local_01/session_name.v2');
      expect(result.type).toBe('agent');
      const agentAddr = result as AgentAddress;
      expect(agentAddr.machineId).toBe('machine.local_01');
      expect(agentAddr.identifier).toBe('session_name.v2');
    });
  });
});

// ============================================================================
// formatAddress
// ============================================================================

describe('formatAddress', () => {
  test('formats AgentAddress to URI string', () => {
    const addr: AgentAddress = { type: 'agent', machineId: 'mac-001', identifier: 'sess-123' };
    expect(formatAddress(addr)).toBe('agent://mac-001/sess-123');
  });

  test('formats ProjectAddress to URI string', () => {
    const addr: ProjectAddress = { type: 'project', machineId: 'mac-001', repoPath: 'path/to/repo' };
    expect(formatAddress(addr)).toBe('project://mac-001/path/to/repo');
  });

  test('formats BroadcastAddress to URI string', () => {
    const addr: BroadcastAddress = { type: 'broadcast', channelName: 'general' };
    expect(formatAddress(addr)).toBe('broadcast://general');
  });
});

// ============================================================================
// Round-trip: parse -> format
// ============================================================================

describe('parse-format round-trip', () => {
  const uris = [
    'agent://machine-123/session-456',
    'agent://mac-001/jolly-squid',
    'project://mac-002/Users/dev/my-app',
    'broadcast://general-channel',
  ];

  for (const uri of uris) {
    test(`round-trip preserves "${uri}"`, () => {
      const parsed = parseAddress(uri);
      const formatted = formatAddress(parsed);
      expect(formatted).toBe(uri);
    });
  }
});

// ============================================================================
// validateAddress
// ============================================================================

describe('validateAddress', () => {
  test('returns true for valid agent address', () => {
    expect(validateAddress('agent://machine-1/session-1')).toBe(true);
  });

  test('returns true for valid project address', () => {
    expect(validateAddress('project://machine-1/repo/path')).toBe(true);
  });

  test('returns true for valid broadcast address', () => {
    expect(validateAddress('broadcast://my-channel')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(validateAddress('')).toBe(false);
  });

  test('returns false for missing protocol', () => {
    expect(validateAddress('no-protocol-here')).toBe(false);
  });

  test('returns false for unknown protocol', () => {
    expect(validateAddress('http://example.com')).toBe(false);
  });

  test('returns false for incomplete agent address', () => {
    expect(validateAddress('agent://machine-only')).toBe(false);
  });

  test('returns false for empty body', () => {
    expect(validateAddress('agent://')).toBe(false);
  });
});

// ============================================================================
// resolveAgentAddress
// ============================================================================

describe('resolveAgentAddress', () => {
  test('extracts machineId and identifier from AgentAddress', () => {
    const addr: AgentAddress = {
      type: 'agent',
      machineId: 'mac-001',
      identifier: 'session-abc',
    };
    const resolved = resolveAgentAddress(addr);
    expect(resolved.machineId).toBe('mac-001');
    expect(resolved.identifier).toBe('session-abc');
  });

  test('works with parsed agent address', () => {
    const parsed = parseAddress('agent://machine-xyz/jolly-squid') as AgentAddress;
    const resolved = resolveAgentAddress(parsed);
    expect(resolved.machineId).toBe('machine-xyz');
    expect(resolved.identifier).toBe('jolly-squid');
  });
});
