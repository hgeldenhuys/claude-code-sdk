/**
 * Tests for Client-Side RLS Filter
 *
 * Covers: RLSFilter.shouldDeliver() for direct, channel, broadcast,
 * and no-target messages, plus dynamic membership updates.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

import { RLSFilter } from '../../../src/comms/security/row-level-security';
import type { Message } from '../../../src/comms/protocol/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal Message for testing.
 * Only the fields used by RLSFilter are required.
 */
function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || 'msg-' + Math.random().toString(36).slice(2, 10),
    channelId: overrides.channelId || '',
    senderId: overrides.senderId || 'sender-001',
    targetType: overrides.targetType || 'agent',
    targetAddress: overrides.targetAddress || '',
    messageType: overrides.messageType || 'chat',
    content: overrides.content || 'hello',
    metadata: overrides.metadata || {},
    status: overrides.status || 'pending',
    claimedBy: overrides.claimedBy || null,
    claimedAt: overrides.claimedAt || null,
    threadId: overrides.threadId || null,
    createdAt: overrides.createdAt || new Date().toISOString(),
    expiresAt: overrides.expiresAt || null,
  };
}

// ============================================================================
// RLSFilter Tests
// ============================================================================

describe('RLSFilter', () => {
  const agentId = 'agent-abc-123';
  const machineId = 'machine-xyz-789';
  const sessionId1 = 'session-001-aaa';
  const sessionId2 = 'session-002-bbb';
  const channelGeneral = 'ch-general';
  const channelPrivate = 'ch-private';

  let filter: RLSFilter;

  beforeEach(() => {
    filter = new RLSFilter(
      agentId,
      machineId,
      new Set([channelGeneral]),
      new Set([sessionId1, sessionId2]),
    );
  });

  // --------------------------------------------------------------------------
  // Direct Messages
  // --------------------------------------------------------------------------

  describe('direct messages', () => {
    test('delivers message targeted to matching agent ID', () => {
      const msg = createMessage({
        targetAddress: `agent://${machineId}/${agentId}`,
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('delivers message targeted to matching session ID', () => {
      const msg = createMessage({
        targetAddress: `agent://${machineId}/${sessionId1}`,
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('delivers message targeted to matching machine ID', () => {
      const msg = createMessage({
        targetAddress: `project://${machineId}/some-project`,
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('drops message targeted to different agent', () => {
      const msg = createMessage({
        targetAddress: 'agent://other-machine/other-agent-999',
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('drops message targeted to different session', () => {
      const msg = createMessage({
        targetAddress: 'agent://other-machine/session-999-zzz',
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('delivers when targetAddress partially contains agent ID', () => {
      const msg = createMessage({
        targetAddress: `some-prefix-${agentId}-some-suffix`,
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Channel Messages
  // --------------------------------------------------------------------------

  describe('channel messages', () => {
    test('delivers channel message when agent is a member', () => {
      const msg = createMessage({
        channelId: channelGeneral,
        targetAddress: '', // channel messages have no direct target
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('drops channel message when agent is not a member', () => {
      const msg = createMessage({
        channelId: channelPrivate,
        targetAddress: '', // not a member of ch-private
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('drops channel message for unknown channel', () => {
      const msg = createMessage({
        channelId: 'ch-unknown-channel',
        targetAddress: '',
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Broadcast Messages
  // --------------------------------------------------------------------------

  describe('broadcast messages', () => {
    test('always delivers broadcast messages', () => {
      const msg = createMessage({
        metadata: { deliveryMode: 'broadcast' },
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('delivers broadcast even without target or channel', () => {
      const msg = createMessage({
        targetAddress: '',
        channelId: '',
        metadata: { deliveryMode: 'broadcast' },
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('delivers broadcast with unknown channel', () => {
      const msg = createMessage({
        channelId: 'ch-not-a-member',
        metadata: { deliveryMode: 'broadcast' },
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // No Target Messages
  // --------------------------------------------------------------------------

  describe('no target messages', () => {
    test('drops message with no target and no channel', () => {
      const msg = createMessage({
        targetAddress: '',
        channelId: '',
        metadata: {},
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('drops message with empty metadata', () => {
      const msg = createMessage({
        targetAddress: '',
        channelId: '',
      });

      expect(filter.shouldDeliver(msg)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Dynamic Membership Updates
  // --------------------------------------------------------------------------

  describe('dynamic membership updates', () => {
    test('delivers after adding channel membership', () => {
      // Initially not a member of ch-private
      const msg = createMessage({
        channelId: channelPrivate,
        targetAddress: '',
      });
      expect(filter.shouldDeliver(msg)).toBe(false);

      // Add membership
      filter.updateMemberships(new Set([channelGeneral, channelPrivate]));

      // Now should deliver
      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('drops after removing channel membership', () => {
      const msg = createMessage({
        channelId: channelGeneral,
        targetAddress: '',
      });
      expect(filter.shouldDeliver(msg)).toBe(true);

      // Remove membership
      filter.updateMemberships(new Set([]));

      // Now should drop
      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('getMemberships returns current memberships', () => {
      const memberships = filter.getMemberships();
      expect(memberships.size).toBe(1);
      expect(memberships.has(channelGeneral)).toBe(true);
    });

    test('updateMemberships replaces (not appends) memberships', () => {
      filter.updateMemberships(new Set(['ch-new']));

      const memberships = filter.getMemberships();
      expect(memberships.size).toBe(1);
      expect(memberships.has('ch-new')).toBe(true);
      expect(memberships.has(channelGeneral)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Dynamic Session ID Updates
  // --------------------------------------------------------------------------

  describe('dynamic session ID updates', () => {
    test('delivers after adding session ID', () => {
      const newSessionId = 'session-003-ccc';
      // Use a target address that does NOT contain our machineId or agentId,
      // so only the session ID set determines delivery
      const msg = createMessage({
        targetAddress: `agent://other-machine/${newSessionId}`,
      });

      // Initially not known (newSessionId not in filter)
      expect(filter.shouldDeliver(msg)).toBe(false);

      // Add session ID
      filter.updateSessionIds(new Set([sessionId1, sessionId2, newSessionId]));

      // Now should deliver
      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('drops after removing session ID', () => {
      // Use a target address that only matches via sessionId1,
      // not via machineId or agentId
      const msg = createMessage({
        targetAddress: `agent://other-machine/${sessionId1}`,
      });
      expect(filter.shouldDeliver(msg)).toBe(true);

      // Remove session1
      filter.updateSessionIds(new Set([sessionId2]));

      // Now should drop (sessionId1 no longer known)
      expect(filter.shouldDeliver(msg)).toBe(false);
    });

    test('getSessionIds returns current session IDs', () => {
      const sessions = filter.getSessionIds();
      expect(sessions.size).toBe(2);
      expect(sessions.has(sessionId1)).toBe(true);
      expect(sessions.has(sessionId2)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    test('message with both channelId and targetAddress uses direct match', () => {
      // When both channelId and targetAddress are present,
      // targetAddress takes precedence (it is a direct message)
      const msg = createMessage({
        channelId: 'ch-not-a-member',
        targetAddress: `agent://${machineId}/${agentId}`,
      });

      expect(filter.shouldDeliver(msg)).toBe(true);
    });

    test('filter with no memberships or sessions rejects channel messages', () => {
      const emptyFilter = new RLSFilter(agentId, machineId);

      const msg = createMessage({
        channelId: channelGeneral,
        targetAddress: '',
      });

      expect(emptyFilter.shouldDeliver(msg)).toBe(false);
    });

    test('filter with no sessions still matches agentId', () => {
      const noSessionFilter = new RLSFilter(agentId, machineId);

      const msg = createMessage({
        targetAddress: agentId,
      });

      expect(noSessionFilter.shouldDeliver(msg)).toBe(true);
    });

    test('filter with no sessions still matches machineId', () => {
      const noSessionFilter = new RLSFilter(agentId, machineId);

      const msg = createMessage({
        targetAddress: machineId,
      });

      expect(noSessionFilter.shouldDeliver(msg)).toBe(true);
    });
  });
});
