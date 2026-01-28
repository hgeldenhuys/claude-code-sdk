/**
 * MemoClaimer - Atomic claiming and state machine transitions
 *
 * Handles the memo lifecycle:
 *   pending -> claimed -> delivered -> read
 *      |                                |
 *      +------------ expired <----------+
 *
 * Each method fetches the message first to validate the current state
 * before attempting a transition.
 */

import type { SignalDBClient } from '../client/signaldb';
import { SignalDBError } from '../client/signaldb';
import type { MemoConfig, MemoView, ClaimResult } from './types';
import { messageToMemoView } from './composer';

/** Valid state transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['claimed', 'expired'],
  claimed: ['delivered', 'expired'],
  delivered: ['read', 'expired'],
  read: ['expired'],
  expired: [],
};

export class MemoClaimer {
  private readonly client: SignalDBClient;
  private readonly config: MemoConfig;

  constructor(client: SignalDBClient, config: MemoConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Attempt to claim a pending memo.
   * Returns ClaimResult with success=false if already claimed (409).
   */
  async claim(memoId: string): Promise<ClaimResult> {
    try {
      const message = await this.client.messages.claim(memoId, this.config.agentId);
      return {
        success: true,
        memo: messageToMemoView(message),
        claimedBy: this.config.agentId,
      };
    } catch (err) {
      if (err instanceof SignalDBError && err.statusCode === 409) {
        return {
          success: false,
          claimedBy: undefined,
        };
      }
      throw err;
    }
  }

  /**
   * Transition a claimed memo to delivered.
   * Validates that the memo is currently in 'claimed' state.
   */
  async deliver(memoId: string): Promise<MemoView> {
    await this.validateTransition(memoId, 'delivered');
    const message = await this.client.messages.updateStatus(memoId, 'delivered');
    return messageToMemoView(message);
  }

  /**
   * Transition a delivered memo to read.
   * Validates that the memo is currently in 'delivered' state.
   */
  async markRead(memoId: string): Promise<MemoView> {
    await this.validateTransition(memoId, 'read');
    const message = await this.client.messages.updateStatus(memoId, 'read');
    return messageToMemoView(message);
  }

  /**
   * Expire a memo from any non-expired state.
   * Validates that the memo is not already expired.
   */
  async expire(memoId: string): Promise<MemoView> {
    await this.validateTransition(memoId, 'expired');
    const message = await this.client.messages.updateStatus(memoId, 'expired');
    return messageToMemoView(message);
  }

  /**
   * Fetch the message and validate that the desired transition is allowed.
   * Throws descriptive error if the transition is invalid.
   */
  private async validateTransition(memoId: string, targetStatus: string): Promise<void> {
    // Fetch messages for this agent to find the memo by ID
    const messages = await this.client.messages.listForAgent(this.config.agentId, {
      messageType: 'memo',
    });

    let currentStatus: string | null = null;
    for (const msg of messages) {
      if (msg.id === memoId) {
        currentStatus = msg.status;
        break;
      }
    }

    if (currentStatus === null) {
      throw new Error(`Memo not found: ${memoId}`);
    }

    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new Error(
        `Invalid memo state transition: ${currentStatus} -> ${targetStatus}. ` +
        `Allowed transitions from '${currentStatus}': ${allowed?.join(', ') || 'none'}`
      );
    }
  }
}
