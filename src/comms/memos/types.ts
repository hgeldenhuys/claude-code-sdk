/**
 * Memo System Types
 *
 * Memos are async knowledge-sharing messages built on top of SignalDB messages.
 * They use messageType='memo' and store structured metadata (subject, category, priority).
 */

import type { MessageStatus } from '../protocol/types';

// ============================================================================
// Enums / Literal Types
// ============================================================================

/**
 * Categories for organizing memos by purpose.
 */
export type MemoCategory = 'knowledge' | 'finding' | 'question' | 'action-item';

/**
 * Priority levels for memos (P0 = critical, P3 = informational).
 */
export type MemoPriority = 'P0' | 'P1' | 'P2' | 'P3';

// ============================================================================
// Input Types
// ============================================================================

/**
 * Data required to compose and send a new memo.
 */
export interface MemoCompose {
  /** Target address URI: agent://, project://, broadcast:// */
  to: string;
  /** Subject line for the memo */
  subject: string;
  /** Body content of the memo */
  body: string;
  /** Category classification (default: 'knowledge') */
  category?: MemoCategory;
  /** Priority level (default: 'P2') */
  priority?: MemoPriority;
  /** Thread ID for threaded replies */
  threadId?: string;
  /** TTL in seconds - converted to expiresAt ISO string */
  expiresIn?: number;
  /** Additional metadata to merge into message metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// View Types
// ============================================================================

/**
 * Enriched memo view with parsed metadata fields.
 */
export interface MemoView {
  id: string;
  senderId: string;
  to: string;
  subject: string;
  body: string;
  category: MemoCategory;
  priority: MemoPriority;
  status: MessageStatus;
  claimedBy: string | null;
  threadId: string | null;
  createdAt: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filters for querying memos.
 */
export interface MemoFilter {
  category?: MemoCategory;
  priority?: MemoPriority;
  status?: MessageStatus;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of a claim operation.
 */
export interface ClaimResult {
  success: boolean;
  memo?: MemoView;
  claimedBy?: string;
}

/**
 * Summary of a memo thread.
 */
export interface ThreadSummary {
  threadId: string;
  rootMemoId: string;
  participants: string[];
  memoCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  categories: MemoCategory[];
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the MemoClient and its components.
 */
export interface MemoConfig {
  /** SignalDB API base URL */
  apiUrl: string;
  /** Project API key */
  projectKey: string;
  /** This agent's ID */
  agentId: string;
  /** Default channel ID for memo operations */
  channelId?: string;
  /** Default priority for new memos (default: 'P2') */
  defaultPriority?: MemoPriority;
  /** Default category for new memos (default: 'knowledge') */
  defaultCategory?: MemoCategory;
}
