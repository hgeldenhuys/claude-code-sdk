/**
 * Paste Sharing
 *
 * Handles paste recipient management and sharing queries.
 * Provides filtered views for "shared with me" and "my pastes" use cases.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { PasteConfig, PasteView } from './types';
import { pasteToView } from './paste-manager';

// ============================================================================
// Paste Sharing
// ============================================================================

/**
 * Paste sharing and recipient management.
 *
 * @example
 * ```typescript
 * const sharing = new PasteSharing(client, config);
 *
 * // Get pastes shared with me
 * const shared = await sharing.getSharedWithMe();
 *
 * // Get my own pastes
 * const mine = await sharing.getMyPastes();
 *
 * // Check expiration
 * for (const paste of shared) {
 *   if (sharing.isExpired(paste)) {
 *     console.log(`Paste ${paste.id} has expired`);
 *   }
 * }
 * ```
 */
export class PasteSharing {
  private readonly client: SignalDBClient;
  private readonly config: PasteConfig;

  constructor(client: SignalDBClient, config: PasteConfig) {
    this.client = client;
    this.config = config;
  }

  // ==========================================================================
  // Sharing Operations
  // ==========================================================================

  /**
   * Share a paste with a specific recipient.
   * Creates a new paste with the same content targeted to the recipient.
   *
   * @param pasteId - UUID of the paste to share
   * @param recipientId - Target agent UUID
   * @returns The paste view (re-read after sharing)
   */
  async shareWith(pasteId: string, recipientId: string): Promise<PasteView> {
    // Read the original paste
    const original = await this.client.pastes.read(pasteId, this.config.agentId);

    // Create a copy targeted at the recipient
    const shared = await this.client.pastes.create({
      creatorId: this.config.agentId,
      content: original.content,
      contentType: original.contentType,
      accessType: original.accessType,
      ttlSeconds: original.ttlSeconds ?? undefined,
      recipientId,
    });

    return pasteToView(shared);
  }

  /**
   * List pastes shared with this agent (where recipientId = agentId).
   *
   * @returns Array of PasteView objects addressed to this agent
   */
  async getSharedWithMe(): Promise<PasteView[]> {
    const pastes = await this.client.pastes.listForAgent(this.config.agentId);
    const views = pastes.map(pasteToView);
    return views.filter(
      (v) => v.recipientId === this.config.agentId && !v.isExpired,
    );
  }

  /**
   * List pastes created by this agent.
   *
   * @returns Array of PasteView objects created by this agent
   */
  async getMyPastes(): Promise<PasteView[]> {
    const pastes = await this.client.pastes.listForAgent(this.config.agentId);
    const views = pastes.map(pasteToView);
    return views.filter((v) => v.creatorId === this.config.agentId);
  }

  /**
   * Check if a paste has expired based on its expiresAt timestamp.
   *
   * @param paste - The paste to check
   * @returns true if the paste is past its expiration
   */
  isExpired(paste: PasteView): boolean {
    if (paste.expiresAt === null) return false;
    return new Date(paste.expiresAt) < new Date();
  }
}
