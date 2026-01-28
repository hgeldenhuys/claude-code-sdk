/**
 * Paste System Types
 *
 * Type definitions for the ephemeral paste sharing system.
 * Pastes support read-once and TTL-based access modes with
 * optional recipient targeting.
 */

import type { AccessType } from '../protocol/types';

// ============================================================================
// Content Types
// ============================================================================

/**
 * MIME-like content type for pastes.
 */
export type PasteContentType = 'text/plain' | 'application/json' | 'text/markdown' | string;

// ============================================================================
// Input Types
// ============================================================================

/**
 * Data required to compose a new paste.
 */
export interface PasteCompose {
  /** Paste content (text, JSON, markdown, etc.) */
  content: string;
  /** Content type (default: 'text/plain') */
  contentType?: PasteContentType;
  /** Access mode: read_once or ttl (default: 'ttl') */
  accessMode?: AccessType;
  /** TTL in seconds for ttl-mode pastes (default: 3600 = 1h) */
  ttlSeconds?: number;
  /** Target recipient agent ID (optional) */
  recipientId?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// View Types
// ============================================================================

/**
 * Rich view of a paste with derived fields.
 */
export interface PasteView {
  /** Paste UUID */
  id: string;
  /** Creator agent ID */
  creatorId: string;
  /** Paste content */
  content: string;
  /** MIME-like content type */
  contentType: string;
  /** Access mode: read_once or ttl */
  accessMode: AccessType;
  /** TTL in seconds (null if none) */
  ttlSeconds: number | null;
  /** Intended recipient agent ID (null if open) */
  recipientId: string | null;
  /** List of agent IDs that have read this paste */
  readBy: string[];
  /** Timestamp of first read (ISO 8601) */
  readAt: string | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Expiration timestamp (ISO 8601, null if none) */
  expiresAt: string | null;
  /** Whether the paste has expired (derived: expiresAt < now) */
  isExpired: boolean;
  /** Whether the paste has been read (derived: readAt !== null) */
  isRead: boolean;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filters for listing pastes.
 */
export interface PasteFilter {
  /** Filter by creator */
  creatorId?: string;
  /** Filter by recipient */
  recipientId?: string;
  /** Filter by content type */
  contentType?: PasteContentType;
  /** Include expired pastes (default: false) */
  includeExpired?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the paste system.
 */
export interface PasteConfig {
  /** SignalDB API base URL */
  apiUrl: string;
  /** Project API key */
  projectKey: string;
  /** This agent's ID */
  agentId: string;
}
