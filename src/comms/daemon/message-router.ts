/**
 * Message Router
 *
 * Routes incoming SignalDB messages to the correct local Claude Code session.
 * Uses `Bun.spawn(['claude', '--resume', sessionId, '--dangerously-skip-permissions', '--append-system-prompt', ctx, '-p', content])`
 * to deliver messages with COMMS context and captures the response output.
 * The --dangerously-skip-permissions flag is required because headless Claude
 * processes cannot prompt the user for file write permissions.
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
const CLAUDE_BINARY = process.env.CLAUDE_BINARY ?? path.join(os.homedir(), '.local', 'bin', 'claude');

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
  private readonly machineId: string;

  /**
   * Session branch tracking for conversation memory continuity.
   *
   * Maps SignalDB threadId → forked session ID.
   *
   * When a headless Claude process resumes a large session (e.g., the agent's
   * main interactive session with 200K+ context), auto-compaction can drop
   * recent headless turns, causing memory loss between Discord messages.
   *
   * To fix this, the first message in a thread forks a lightweight session
   * via `--fork-session`. Subsequent messages resume the fork, building a
   * small, focused context where memory persists across turns.
   */
  private readonly sessionBranches: Map<string, string> = new Map();

  constructor(client: SignalDBClient, security?: SecurityMiddleware, machineId?: string) {
    this.client = client;
    this.security = security ?? null;
    this.machineId = machineId ?? 'unknown';
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

    // Route the message to the Claude session with session branching
    try {
      // Determine the effective threadId for branch tracking.
      // The thread root message's ID is used as the key.
      const threadId = message.threadId ?? message.id;

      // Check if we already have a branch session for this conversation thread
      const existingBranch = this.sessionBranches.get(threadId);

      const result = await this.deliverToSession(
        targetSession.sessionId,
        message,
        targetSession.projectPath,
        existingBranch,
      );

      // Update the branch mapping with the session ID returned by Claude.
      // On first message: this is the newly forked session.
      // On subsequent messages: this is the same branch session.
      if (result.branchSessionId) {
        this.sessionBranches.set(threadId, result.branchSessionId);
      }

      log.info('Message delivered successfully', {
        messageId: message.id.slice(0, 8),
        sessionId: targetSession.sessionId.slice(0, 8),
        branchSessionId: result.branchSessionId?.slice(0, 8),
        threadId: threadId.slice(0, 8),
        responseLength: result.response.length,
      });

      // Post the response back to SignalDB with session branching metadata
      if (targetSession.agentId) {
        await this.postResponse(
          message,
          targetSession.agentId,
          result.response,
          result.branchSessionId ?? targetSession.sessionId,
          targetSession.projectPath,
        );
      }

      // Update message status to delivered
      try {
        await this.client.messages.updateStatus(message.id, 'delivered');
      } catch {
        // Non-critical - status update failure doesn't affect routing
      }

      return {
        ok: true,
        response: result.response,
        messageId: message.id,
        branchSessionId: result.branchSessionId,
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
   * Tells Claude this is a COMMS message, who sent it, the primitive type,
   * and how to respond.
   */
  private buildSystemPrompt(message: Message): string {
    // Describe the primitive type and expected behavior
    let typeLabel: string;
    let typeBehavior: string;
    switch (message.messageType) {
      case 'sync':
        typeLabel = 'Sync Message';
        typeBehavior = 'real-time, response expected';
        break;
      case 'async':
        typeLabel = 'Async Message';
        typeBehavior = 'async inbox delivery, response optional';
        break;
      case 'memo':
        typeLabel = 'Memo';
        typeBehavior = 'broadcast knowledge, no response needed';
        break;
      case 'response':
        typeLabel = 'Response';
        typeBehavior = 'reply to previous message';
        break;
      case 'story-notification':
        typeLabel = 'Story Notification';
        typeBehavior = 'story state change, informational';
        break;
      default:
        typeLabel = 'Message';
        typeBehavior = 'unknown type';
    }

    const threadLine = message.threadId
      ? `Thread: ${message.threadId}`
      : 'Thread: new conversation';

    const lines = [
      `[COMMS: Incoming ${typeLabel}]`,
      'This message was delivered via the Tapestry COMMS system.',
      `From: ${message.senderId}`,
      `Type: ${message.messageType} (${typeBehavior})`,
      threadLine,
      `Channel: ${message.channelId}`,
      `Message ID: ${message.id}`,
    ];

    // Add source context (Discord, CLI, etc.)
    const meta = message.metadata ?? {};
    if (meta.source) {
      const sourceParts = [`Source: ${meta.source}`];
      if (meta.discordChannel) {
        sourceParts.push(`channel: ${meta.discordChannel}`);
      }
      if (meta.discordUser) {
        sourceParts.push(`user: ${meta.discordUser}`);
      }
      lines.push(sourceParts.join(', '));
    }

    lines.push(
      '',
      'Your response will be automatically sent back to the sender via COMMS.',
      'Execute the request and provide a clear response.',
    );
    return lines.join('\n');
  }

  /**
   * Deliver a message to a local Claude session via the `claude` CLI.
   *
   * Uses session branching for conversation memory continuity:
   * - First message in a thread: `--resume <original> --fork-session` creates
   *   a lightweight branch inheriting the agent's full context
   * - Subsequent messages: `--resume <branch>` continues the branch session
   *
   * Uses `--output-format json` to capture the session_id from each invocation,
   * which tracks whether a fork occurred and provides structured response data.
   *
   * IMPORTANT: Must run from the session's projectPath directory for
   * `claude --resume` to find the session.
   *
   * @param sessionId - Original Claude Code session UUID (the agent's main session)
   * @param message - Full message object (for context injection)
   * @param projectPath - The project directory path for the session
   * @param branchSessionId - Existing branch session ID for this thread (if any)
   * @returns Object with response text and the branch session ID
   */
  private async deliverToSession(
    sessionId: string,
    message: Message,
    projectPath: string,
    branchSessionId?: string,
  ): Promise<{ response: string; branchSessionId: string | null }> {
    const systemPrompt = this.buildSystemPrompt(message);

    // Decide which session to resume and whether to fork:
    // - If we have a branch session from a prior turn, resume it (no fork)
    // - Otherwise, fork from the original session to create a new branch
    const resumeId = branchSessionId ?? sessionId;
    const shouldFork = !branchSessionId;

    const args = [
      CLAUDE_BINARY,
      '--resume', resumeId,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--append-system-prompt', systemPrompt,
      '-p', message.content,
    ];

    if (shouldFork) {
      // Insert --fork-session before -p to create a new branch session
      args.splice(args.indexOf('-p'), 0, '--fork-session');
    }

    log.info('Spawning claude process', {
      sessionId: sessionId.slice(0, 8),
      resumeId: resumeId.slice(0, 8),
      forking: shouldFork,
      messageId: message.id.slice(0, 8),
      projectPath,
      binary: CLAUDE_BINARY,
    });

    const proc = Bun.spawn(args, {
      cwd: projectPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      log.warn('Claude process timed out, killing', {
        sessionId: sessionId.slice(0, 8),
        resumeId: resumeId.slice(0, 8),
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

      // Parse JSON output to extract response and session_id
      const trimmed = stdout.trim();
      try {
        const json = JSON.parse(trimmed) as {
          result?: string;
          session_id?: string;
          is_error?: boolean;
        };

        const response = json.result ?? trimmed;
        const returnedSessionId = json.session_id ?? null;

        if (json.is_error) {
          throw new Error(`Claude returned error: ${response}`);
        }

        log.debug('Parsed JSON response', {
          sessionId: returnedSessionId?.slice(0, 8),
          forked: shouldFork,
          responseLength: response.length,
        });

        return { response, branchSessionId: returnedSessionId };
      } catch (parseErr) {
        // If JSON parsing fails, fall back to raw text output.
        // This can happen if Claude outputs non-JSON (e.g., older CLI version).
        if (parseErr instanceof SyntaxError) {
          log.warn('Failed to parse JSON output, falling back to raw text', {
            messageId: message.id.slice(0, 8),
          });
          return { response: trimmed, branchSessionId: null };
        }
        throw parseErr;
      }
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
   * Includes session branching metadata so the receiver can resume this session.
   */
  private async postResponse(
    originalMessage: Message,
    senderAgentId: string,
    responseContent: string,
    sessionId?: string,
    projectPath?: string,
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
        sessionBranch: sessionId ? {
          sessionId,
          machineId: this.machineId,
          projectPath,
        } : undefined,
      },
    });
  }
}
