/**
 * Paste Manager
 *
 * Core CRUD operations for paste management.
 * Handles creation, reading, deletion, and listing of pastes.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Paste, PasteCreate } from '../protocol/types';
import type { PasteCompose, PasteConfig, PasteFilter, PasteView } from './types';

// ============================================================================
// Paste Manager
// ============================================================================

/**
 * Core paste CRUD operations.
 *
 * @example
 * ```typescript
 * const manager = new PasteManager(client, config);
 *
 * // Create a paste
 * const paste = await manager.create({
 *   content: 'Hello, world!',
 *   contentType: 'text/plain',
 *   accessMode: 'ttl',
 *   ttlSeconds: 3600,
 * });
 *
 * // Read a paste
 * const view = await manager.read(paste.id);
 *
 * // List pastes
 * const pastes = await manager.list();
 * ```
 */
export class PasteManager {
  private readonly client: SignalDBClient;
  private readonly config: PasteConfig;

  constructor(client: SignalDBClient, config: PasteConfig) {
    this.client = client;
    this.config = config;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new paste.
   *
   * @param compose - Paste composition data
   * @returns The created PasteView
   */
  async create(compose: PasteCompose): Promise<PasteView> {
    if (!compose.content || compose.content.trim().length === 0) {
      throw new Error('Paste content must not be empty');
    }

    const createData: PasteCreate = {
      creatorId: this.config.agentId,
      content: compose.content,
      contentType: compose.contentType ?? 'text/plain',
      accessType: compose.accessMode ?? 'ttl',
      ttlSeconds: compose.ttlSeconds ?? 3600,
      recipientId: compose.recipientId,
    };

    const paste = await this.client.pastes.create(createData);
    return pasteToView(paste);
  }

  /**
   * Read a paste by ID.
   * Automatically marks read_once pastes as read.
   *
   * @param pasteId - UUID of the paste
   * @returns The PasteView
   */
  async read(pasteId: string): Promise<PasteView> {
    const paste = await this.client.pastes.read(pasteId, this.config.agentId);
    return pasteToView(paste);
  }

  /**
   * Delete a paste by ID.
   *
   * @param pasteId - UUID of the paste to delete
   */
  async delete(pasteId: string): Promise<void> {
    await this.client.pastes.delete(pasteId);
  }

  /**
   * List pastes with optional client-side filtering.
   *
   * @param filter - Optional filters
   * @returns Array of PasteView objects
   */
  async list(filter?: PasteFilter): Promise<PasteView[]> {
    const pastes = await this.client.pastes.listForAgent(this.config.agentId);
    let views = pastes.map(pasteToView);

    // Always apply filtering (expired excluded by default)
    views = applyFilter(views, filter ?? {});

    return views;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a raw Paste entity to a PasteView with derived fields.
 */
export function pasteToView(paste: Paste): PasteView {
  const now = new Date();
  const expiresAt = paste.expiresAt;
  const isExpired = expiresAt !== null && new Date(expiresAt) < now;
  const isRead = paste.readAt !== null;

  return {
    id: paste.id,
    creatorId: paste.creatorId,
    content: paste.content,
    contentType: paste.contentType,
    accessMode: paste.accessType,
    ttlSeconds: paste.ttlSeconds,
    recipientId: paste.recipientId,
    readBy: paste.readBy ?? [],
    readAt: paste.readAt,
    createdAt: paste.createdAt,
    expiresAt: paste.expiresAt,
    isExpired,
    isRead,
    metadata: {},
  };
}

/**
 * Apply client-side filters to an array of PasteViews.
 */
function applyFilter(views: PasteView[], filter: PasteFilter): PasteView[] {
  let result = views;

  if (filter.creatorId) {
    result = result.filter((v) => v.creatorId === filter.creatorId);
  }

  if (filter.recipientId) {
    result = result.filter((v) => v.recipientId === filter.recipientId);
  }

  if (filter.contentType) {
    result = result.filter((v) => v.contentType === filter.contentType);
  }

  if (!filter.includeExpired) {
    result = result.filter((v) => !v.isExpired);
  }

  return result;
}
