/**
 * Message Router
 *
 * Routes incoming SignalDB messages to the correct local Claude Code session.
 * Uses `Bun.spawn(['claude', '--resume', sessionId, '-p', content])` to
 * deliver messages and captures the response output.
 *
 * After execution, posts the response back to SignalDB as a 'response' type
 * message via the client.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Message } from '../protocol/types';
import type { LocalSession, MessageRouteResult } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Maximum time to wait for a Claude response (5 minutes) */
const ROUTE_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// MessageRouter
// ============================================================================

/**
 * Routes incoming messages from SignalDB to local Claude Code sessions.
 *
 * Responsibilities:
 * - Match messages to the correct local session
 * - Spawn `claude` CLI to deliver the message content
 * - Capture stdout/stderr from the Claude process
 * - Post response back to SignalDB as a 'response' message
 *
 * @example
 * ```typescript
 * const router = new MessageRouter(signaldbClient);
 * const result = await router.route(incomingMessage, localSessions);
 *
 * if (result.ok) {
 *   console.log('Response:', result.response);
 * } else {
 *   console.error('Route failed:', result.error);
 * }
 * ```
 */
export class MessageRouter {
  private readonly client: SignalDBClient;

  constructor(client: SignalDBClient) {
    this.client = client;
  }

  /**
   * Route an incoming message to the appropriate local Claude Code session.
   *
   * Resolution order:
   * 1. If message.targetAddress contains a session ID, find matching session
   * 2. If message targets a project address, find session with matching projectPath
   * 3. If no match, return failure
   *
   * After routing, the response is sent back via SignalDB.
   *
   * @param message - The incoming SignalDB message to route
   * @param localSessions - Currently active local sessions
   * @returns MessageRouteResult indicating success or failure
   */
  async route(
    message: Message,
    localSessions: LocalSession[],
  ): Promise<MessageRouteResult> {
    // Find the target session
    const targetSession = this.resolveTarget(message, localSessions);

    if (!targetSession) {
      return {
        ok: false,
        error: `No local session matches target address: ${message.targetAddress}`,
        messageId: message.id,
      };
    }

    // Claim the message first
    if (targetSession.agentId && message.status === 'pending') {
      try {
        await this.client.messages.claim(message.id, targetSession.agentId);
      } catch (err) {
        // Another agent might have claimed it first
        return {
          ok: false,
          error: `Failed to claim message: ${err instanceof Error ? err.message : String(err)}`,
          messageId: message.id,
        };
      }
    }

    // Route the message to the Claude session
    try {
      const response = await this.deliverToSession(targetSession.sessionId, message.content);

      // Post the response back to SignalDB
      if (targetSession.agentId) {
        await this.postResponse(message, targetSession.agentId, response);
      }

      // Update message status to delivered
      try {
        await this.client.messages.updateStatus(message.id, 'delivered');
      } catch {
        // Non-critical - status update failure doesn't affect routing
      }

      return {
        ok: true,
        response,
        messageId: message.id,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Failed to deliver message to session ${targetSession.sessionId}: ${errorMsg}`,
        messageId: message.id,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Target Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve which local session should receive this message.
   */
  private resolveTarget(
    message: Message,
    localSessions: LocalSession[],
  ): LocalSession | null {
    if (localSessions.length === 0) return null;

    const targetAddr = message.targetAddress;

    // Try matching by agent ID (direct address)
    if (message.targetType === 'agent') {
      for (let i = 0; i < localSessions.length; i++) {
        const session = localSessions[i]!;
        if (session.agentId && targetAddr.includes(session.agentId)) {
          return session;
        }
        // Also try matching by session ID in the address
        if (targetAddr.includes(session.sessionId)) {
          return session;
        }
      }
    }

    // Try matching by project path (project address)
    if (message.targetType === 'project') {
      for (let i = 0; i < localSessions.length; i++) {
        const session = localSessions[i]!;
        if (session.projectPath && targetAddr.includes(session.projectPath)) {
          return session;
        }
      }
    }

    // Broadcast: deliver to first available session
    if (message.targetType === 'broadcast') {
      return localSessions[0] ?? null;
    }

    // Fallback: try matching by session ID anywhere in target address
    for (let i = 0; i < localSessions.length; i++) {
      const session = localSessions[i]!;
      if (targetAddr.includes(session.sessionId)) {
        return session;
      }
    }

    // Last resort for project messages: if only one session, use it
    if (localSessions.length === 1) {
      return localSessions[0]!;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Message Delivery via Claude CLI
  // --------------------------------------------------------------------------

  /**
   * Deliver a message to a local Claude session via the `claude` CLI.
   *
   * Spawns: `claude --resume <sessionId> -p <content>`
   * Captures stdout as the response.
   *
   * @param sessionId - Claude Code session UUID to resume
   * @param content - Message content to deliver as a prompt
   * @returns The Claude response text
   */
  private async deliverToSession(sessionId: string, content: string): Promise<string> {
    const proc = Bun.spawn(['claude', '--resume', sessionId, '-p', content], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, ROUTE_TIMEOUT_MS);

    try {
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        const errorDetail = stderr.trim() || `exit code ${exitCode}`;
        throw new Error(`Claude process failed: ${errorDetail}`);
      }

      return stdout.trim();
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Response Posting
  // --------------------------------------------------------------------------

  /**
   * Post a response message back to SignalDB.
   */
  private async postResponse(
    originalMessage: Message,
    senderAgentId: string,
    responseContent: string,
  ): Promise<void> {
    await this.client.messages.send({
      channelId: originalMessage.channelId,
      senderId: senderAgentId,
      targetType: originalMessage.targetType,
      targetAddress: originalMessage.senderId, // Reply to the sender
      messageType: 'response',
      content: responseContent,
      threadId: originalMessage.threadId ?? originalMessage.id,
      metadata: {
        inReplyTo: originalMessage.id,
      },
    });
  }
}
