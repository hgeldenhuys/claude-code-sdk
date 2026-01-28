/**
 * Paste Client Facade
 *
 * Unified entry point for paste operations. Composes PasteManager
 * and PasteSharing behind a single ergonomic API.
 */

import { SignalDBClient } from '../client/signaldb';
import { PasteManager } from './paste-manager';
import { PasteSharing } from './paste-sharing';
import type { PasteCompose, PasteConfig, PasteFilter, PasteView } from './types';

// ============================================================================
// Paste Client
// ============================================================================

/**
 * Unified paste client composing all paste components.
 *
 * Composes PasteManager + PasteSharing behind a clean facade:
 * - **CRUD**: create, read, delete, list pastes
 * - **Sharing**: share with recipients, view shared/my pastes
 *
 * @example
 * ```typescript
 * const client = new PasteClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 * });
 *
 * // Create a paste
 * const paste = await client.create({
 *   content: 'Hello, world!',
 *   accessMode: 'ttl',
 *   ttlSeconds: 3600,
 * });
 *
 * // Share with another agent
 * const shared = await client.shareWith(paste.id, 'agent-002');
 *
 * // Read a paste
 * const view = await client.read(paste.id);
 *
 * // List my pastes
 * const mine = await client.getMyPastes();
 *
 * // Delete
 * await client.delete(paste.id);
 * ```
 */
export class PasteClient {
  private readonly manager: PasteManager;
  private readonly sharing: PasteSharing;
  private readonly config: PasteConfig;

  constructor(config: PasteConfig, client?: SignalDBClient) {
    this.config = config;

    // Create REST client from config if not provided
    const restClient = client ?? new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    this.manager = new PasteManager(restClient, config);
    this.sharing = new PasteSharing(restClient, config);
  }

  // ==========================================================================
  // CRUD (delegated to PasteManager)
  // ==========================================================================

  /**
   * Create a new paste.
   */
  async create(compose: PasteCompose): Promise<PasteView> {
    return this.manager.create(compose);
  }

  /**
   * Read a paste by ID.
   * Automatically marks read_once pastes as read.
   */
  async read(pasteId: string): Promise<PasteView> {
    return this.manager.read(pasteId);
  }

  /**
   * Delete a paste by ID.
   */
  async delete(pasteId: string): Promise<void> {
    return this.manager.delete(pasteId);
  }

  /**
   * List pastes with optional filtering.
   */
  async list(filter?: PasteFilter): Promise<PasteView[]> {
    return this.manager.list(filter);
  }

  // ==========================================================================
  // Sharing (delegated to PasteSharing)
  // ==========================================================================

  /**
   * Share a paste with a specific recipient.
   */
  async shareWith(pasteId: string, recipientId: string): Promise<PasteView> {
    return this.sharing.shareWith(pasteId, recipientId);
  }

  /**
   * Get pastes shared with this agent.
   */
  async getSharedWithMe(): Promise<PasteView[]> {
    return this.sharing.getSharedWithMe();
  }

  /**
   * Get pastes created by this agent.
   */
  async getMyPastes(): Promise<PasteView[]> {
    return this.sharing.getMyPastes();
  }

  /**
   * Check if a paste has expired.
   */
  isExpired(paste: PasteView): boolean {
    return this.sharing.isExpired(paste);
  }
}
