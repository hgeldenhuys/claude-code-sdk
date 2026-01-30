/**
 * Message Router
 *
 * Routes incoming SignalDB messages to the correct local Claude Code session.
 * Uses `Bun.spawn(['claude', '--resume', sessionId, '--append-system-prompt', ctx, '-p', content])`
 * to deliver messages with COMMS context and captures the response output.
 *
 * After execution, posts the response back to SignalDB as a 'response' type
 * message via the client.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { SignalDBClient } from '../client/signaldb';
import type { Message } from '../protocol/types';
import type { SecurityMiddleware } from '../security/middleware';
import { RateLimitError } from '../security/middleware';
import type { LocalSession, MessageRouteResult } from './types';
import { createLogger } from './logger';

const log = createLogger('router');

// ============================================================================
// Constants
// ============================================================================

/** Maximum time to wait for a Claude response (5 minutes) */
const ROUTE_TIMEOUT_MS = 5 * 60 * 1000;

/** Path to the claude binary (resolved from typical install locations) */
const CLAUDE_BINARY = path.join(os.homedir(), '.local', 'bin', 'claude');

// ============================================================================
// MessageRouter
// ============================================================================

/**
 * Routes incoming messages from SignalDB to local Claude Code sessions.
 *
 * Responsibilities:
 * - Match messages to the correct local session
 * - Spawn `claude` CLI to deliver the message content with COMMS context
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
  private readonly security: SecurityMiddleware | null;

  constructor(client: SignalDBClient, security?: SecurityMiddleware) {
    this.client = client;
    this.security = security ?? null;
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
      log.warn('No matching session for message', {
        messageId: message.id.slice(0, 8),
        targetAddress: message.targetAddress,
        sessionCount: localSessions.length,
      });
      return {
        ok: false,
        error: `No local session matches target address: ${message.targetAddress}`,
        messageId: message.id,
      };
    }

    log.info('Routing message to session', {
      messageId: message.id.slice(0, 8),
      sessionId: targetSession.sessionId.slice(0, 8),
      sessionName: targetSession.sessionName,
      senderId: message.senderId.slice(0, 8),
      type: message.messageType,
    });

    // Apply security checks before delivery
    if (this.security) {
      const startMs = Date.now();
      try {
        // 1. Rate limiting check (60 msg/min per agent)
        this.security.checkAndRecord('message');

        // 2. Content validation and sanitization
        this.security.validateAndSanitize(message.content);

        // 3. Directory enforcement on message content
        this.security.enforceDirectory(message.content);

        // 4. Audit log the incoming message
        await this.security.audit({
          receiverId: targetSession.agentId ?? targetSession.sessionId,
          command: `route:${message.messageType}`,
          result: 'allowed',
          durationMs: Date.now() - startMs,
        });
      } catch (err) {
        // Audit log the blocked message
        const errorMsg = err instanceof Error ? err.message : String(err);
        try {
          await this.security.audit({
            receiverId: targetSession.agentId ?? targetSession.sessionId,
            command: `route:${message.messageType}`,
            result: `blocked:${err instanceof RateLimitError ? 'rate_limit' : 'security'}`,
            durationMs: Date.now() - startMs,
          });
        } catch {
          // Audit logging failure is non-critical
        }

        log.warn('Security check blocked message', {
          messageId: message.id.slice(0, 8),
          error: errorMsg,
          isRateLimit: err instanceof RateLimitError,
        });

        return {
          ok: false,
          error: `Security check failed: ${errorMsg}`,
          messageId: message.id,
        };
      }
    }

    // Claim the message first
    if (targetSession.agentId && message.status === 'pending') {
      try {
        await this.client.messages.claim(message.id, targetSession.agentId);
      } catch (err) {
        // Another agent might have claimed it first
        log.warn('Failed to claim message', {
          messageId: message.id.slice(0, 8),
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          error: `Failed to claim message: ${err instanceof Error ? err.message : String(err)}`,
          messageId: message.id,
        };
      }
    }

    // Route the message to the Claude session
    try {
      const response = await this.deliverToSession(targetSession.sessionId, message, targetSession.projectPath);

      log.info('Message delivered successfully', {
        messageId: message.id.slice(0, 8),
        sessionId: targetSession.sessionId.slice(0, 8),
        responseLength: response.length,
      });

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
      log.error('Failed to deliver message', {
        messageId: message.id.slice(0, 8),
        sessionId: targetSession.sessionId.slice(0, 8),
        error: errorMsg,
      });
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
   *
   * Resolution order for agent addresses:
   * 1. Match by agent ID (database UUID)
   * 2. Match by session ID (Claude Code session UUID)
   * 3. Match by session name (human-friendly name like "tender-mongoose")
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
        // Also try matching by session name (e.g., "agent://machine/tender-mongoose")
        if (session.sessionName && targetAddr.includes(session.sessionName)) {
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
   * Build COMMS context system prompt for the Claude session.
   * Tells Claude this is a COMMS message, who sent it, and how to respond.
   */
  private buildSystemPrompt(message: Message): string {
    const lines = [
      '[COMMS: Incoming Message]',
      'This message was delivered via the Tapestry COMMS system.',
      `From: ${message.senderId}`,
      `Channel: ${message.channelId}`,
      `Message ID: ${message.id}`,
      `Type: ${message.messageType}`,
      '',
      'Your response will be automatically sent back to the sender via COMMS.',
      'Execute the request and provide a clear response.',
    ];
    return lines.join('\n');
  }

  /**
   * Deliver a message to a local Claude session via the `claude` CLI.
   *
   * Spawns: `claude --resume <sessionId> --append-system-prompt <context> -p <content>`
   * Captures stdout as the response.
   *
   * IMPORTANT: Must run from the session's projectPath directory for
   * `claude --resume` to find the session.
   *
   * @param sessionId - Claude Code session UUID to resume
   * @param message - Full message object (for context injection)
   * @param projectPath - The project directory path for the session
   * @returns The Claude response text
   */
  private async deliverToSession(sessionId: string, message: Message, projectPath: string): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(message);

    log.debug('Spawning claude process', {
      sessionId: sessionId.slice(0, 8),
      messageId: message.id.slice(0, 8),
      projectPath,
    });

    const proc = Bun.spawn(
      [CLAUDE_BINARY, '--resume', sessionId, '--append-system-prompt', systemPrompt, '-p', message.content],
      {
        cwd: projectPath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      },
    );

    // Set up timeout
    const timeoutId = setTimeout(() => {
      log.warn('Claude process timed out, killing', {
        sessionId: sessionId.slice(0, 8),
        messageId: message.id.slice(0, 8),
        timeoutMs: ROUTE_TIMEOUT_MS,
      });
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
