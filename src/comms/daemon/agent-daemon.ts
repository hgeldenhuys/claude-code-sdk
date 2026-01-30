/**
 * Agent Daemon Orchestrator
 *
 * Main daemon process that bridges local Claude Code sessions to the
 * SignalDB communication network. Orchestrates:
 *
 * 1. Session discovery on the local machine
 * 2. Agent registration in SignalDB for each session
 * 3. Heartbeat loops to maintain presence
 * 4. SSE subscription for real-time message delivery
 * 5. Message routing to the correct local session
 * 6. Periodic SSE health checks to detect silent stream death
 * 7. Graceful shutdown on SIGINT/SIGTERM
 */

import type { SignalDBClient } from '../client/signaldb';
import { AgentRegistry } from '../registry/agent-registry';
import type { Message } from '../protocol/types';
import { SecurityManager } from '../security/security-manager';
import { SecurityMiddleware } from '../security/middleware';
import { JWTManager } from '../security/jwt-manager';
import { RLSFilter } from '../security/row-level-security';
import { discoverSessions } from './session-discovery';
import { SSEClient } from './sse-client';
import { MessageRouter } from './message-router';
import { writeToInbox } from './inbox-writer';
import { createLogger } from './logger';
import type {
  DaemonConfig,
  DaemonState,
  DaemonCallbacks,
  LocalSession,
} from './types';

const log = createLogger('daemon');

// ============================================================================
// AgentDaemon
// ============================================================================

/**
 * Main daemon class that orchestrates agent lifecycle, SSE subscription,
 * and message routing for local Claude Code sessions.
 *
 * @example
 * ```typescript
 * const daemon = new AgentDaemon(client, config);
 *
 * daemon.on('stateChange', (state) => console.log('State:', state));
 * daemon.on('error', (err) => console.error('Error:', err));
 *
 * await daemon.start();
 *
 * // Later...
 * await daemon.stop();
 * ```
 */
export class AgentDaemon {
  private readonly client: SignalDBClient;
  private readonly config: DaemonConfig;
  private readonly registry: AgentRegistry;
  private readonly router: MessageRouter;
  private readonly callbacks: DaemonCallbacks;

  /** Map of sessionId -> LocalSession for multiplexing */
  private sessions: Map<string, LocalSession> = new Map();

  /** Map of sessionId -> heartbeat cleanup function */
  private heartbeats: Map<string, () => void> = new Map();

  /** SSE client instance */
  private sseClient: SSEClient | null = null;

  /** Current daemon state */
  private state: DaemonState = 'stopped';

  /** Signal handler cleanup references */
  private signalHandlers: Array<{ signal: string; handler: () => void }> = [];

  /** Session discovery polling interval */
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;

  /** Discovery polling interval in ms (5 seconds for near-realtime) */
  private readonly discoveryIntervalMs: number = 5_000;

  /** Timestamp when daemon was started */
  private startedAt: number = 0;

  /** JWT manager for agent token creation and refresh */
  private jwtManager: JWTManager | null = null;

  /** Current JWT token (refreshed on heartbeat cycle) */
  private currentToken: string | null = null;

  /** SecurityManager facade (when security config is provided) */
  private securityManager: SecurityManager | null = null;

  /** Audit auto-flush cleanup function */
  private auditFlushCleanup: (() => void) | null = null;

  /** Client-side RLS filter for SSE messages */
  private rlsFilter: RLSFilter | null = null;

  constructor(
    client: SignalDBClient,
    config: DaemonConfig,
    callbacks?: DaemonCallbacks,
  ) {
    this.client = client;
    this.config = config;
    this.registry = new AgentRegistry(client);
    this.callbacks = callbacks ?? {};

    // Initialize security if config is provided
    if (config.security) {
      this.securityManager = new SecurityManager(config.security, client);
      this.jwtManager = this.securityManager.jwt;

      // Create SecurityMiddleware and inject into MessageRouter
      const middleware = new SecurityMiddleware(
        this.securityManager,
        config.machineId,
        config.machineId,
      );
      this.router = new MessageRouter(client, middleware);
    } else {
      this.router = new MessageRouter(client);
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start the daemon: discover sessions, register agents, start heartbeats,
   * connect SSE.
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return;
    }

    this.setState('starting');
    this.startedAt = Date.now();

    try {
      // 1. Install signal handlers
      this.installSignalHandlers();

      // 1b. Create JWT token on startup and attach to client headers
      if (this.jwtManager) {
        this.currentToken = this.jwtManager.createToken(
          this.config.machineId,
          this.config.machineId,
          ['daemon', 'route', 'heartbeat'],
        );
        this.client.setHeader('X-Agent-Token', this.currentToken);
        log.info('JWT token created and attached to client headers');
      }

      // 1c. Start audit auto-flush if security is enabled
      if (this.securityManager) {
        this.auditFlushCleanup = this.securityManager.startAuditAutoFlush();
        log.debug('Audit auto-flush started');
      }

      // 2. Discover local sessions
      const discovered = await discoverSessions(this.config.machineId);

      if (discovered.length === 0) {
        log.info('No active Claude Code sessions found');
      } else {
        log.info('Discovered active sessions', { count: discovered.length });
      }

      // 3. Register each session in SignalDB
      for (let i = 0; i < discovered.length; i++) {
        const session = discovered[i]!;
        await this.registerSession(session);
      }

      // 3b. Create RLS filter with initial session IDs
      const sessionIds = new Set<string>();
      for (const [sessionId] of this.sessions) {
        sessionIds.add(sessionId);
      }
      this.rlsFilter = new RLSFilter(
        this.config.machineId,
        this.config.machineId,
        new Set<string>(), // channel memberships populated dynamically
        sessionIds,
      );
      log.info('RLS filter initialized', { sessionIds: sessionIds.size });

      // 4. Start heartbeat loops for all registered agents
      for (const [sessionId, session] of this.sessions) {
        if (session.agentId) {
          this.startHeartbeat(sessionId, session.agentId);
        }
      }

      // 5. Connect SSE for real-time messages
      await this.connectSSE();

      // 6. Start session discovery polling (5s interval)
      this.startDiscoveryPolling();

      this.setState('running');
      log.info('Daemon running', { machineId: this.config.machineId, sessions: this.sessions.size });
    } catch (err) {
      this.setState('error');
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Startup failed', { error: error.message });
      this.callbacks.onError?.(error);
      throw err;
    }
  }

  /**
   * Stop the daemon: disconnect SSE, stop heartbeats, deregister all agents.
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') {
      return;
    }

    this.setState('stopping');
    log.info('Stopping daemon');

    // 1. Stop discovery polling
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    // 2. Disconnect SSE
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }

    // 3. Stop all heartbeat loops
    for (const [sessionId, cleanup] of this.heartbeats) {
      cleanup();
      log.debug('Stopped heartbeat', { sessionId: sessionId.slice(0, 8) });
    }
    this.heartbeats.clear();

    // 4. Deregister all agents from SignalDB
    for (const [sessionId, session] of this.sessions) {
      if (session.agentId) {
        try {
          await this.registry.deregister(session.agentId);
          log.info('Deregistered agent', {
            agentId: session.agentId.slice(0, 8),
            sessionId: sessionId.slice(0, 8),
          });
        } catch (err) {
          log.warn('Failed to deregister agent', {
            agentId: session.agentId.slice(0, 8),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    this.sessions.clear();

    // 5. Cleanup security resources
    if (this.auditFlushCleanup) {
      this.auditFlushCleanup();
      this.auditFlushCleanup = null;
    }
    if (this.securityManager) {
      this.securityManager.shutdown();
    }
    this.currentToken = null;

    // 6. Remove signal handlers
    this.removeSignalHandlers();

    this.setState('stopped');
    log.info('Daemon stopped', { uptimeMs: Date.now() - this.startedAt });
  }

  /**
   * Get the current daemon state.
   */
  getState(): DaemonState {
    return this.state;
  }

  /**
   * Get the number of registered sessions.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all registered local sessions.
   */
  getSessions(): LocalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get daemon uptime in milliseconds.
   */
  getUptime(): number {
    if (this.startedAt === 0) return 0;
    return Date.now() - this.startedAt;
  }

  /**
   * Get the current JWT token (for diagnostics/testing).
   */
  getCurrentToken(): string | null {
    return this.currentToken;
  }

  /**
   * Get the SecurityManager instance (for diagnostics/testing).
   */
  getSecurityManager(): SecurityManager | null {
    return this.securityManager;
  }

  /**
   * Get the RLS filter instance (for diagnostics/testing).
   */
  getRLSFilter(): RLSFilter | null {
    return this.rlsFilter;
  }

  /**
   * Update RLS channel memberships.
   * Call when channel subscriptions change (join/leave).
   */
  updateChannelMemberships(channels: Set<string>): void {
    if (this.rlsFilter) {
      this.rlsFilter.updateMemberships(channels);
      log.info('Updated RLS channel memberships', { count: channels.size });
    }
  }

  // --------------------------------------------------------------------------
  // Session Registration
  // --------------------------------------------------------------------------

  private async registerSession(session: LocalSession): Promise<void> {
    try {
      const agent = await this.registry.register({
        machineId: this.config.machineId,
        sessionId: session.sessionId,
        sessionName: session.sessionName ?? undefined,
        projectPath: session.projectPath,
        capabilities: { daemon: true },
      });

      // Update session with the assigned agent ID
      const registered: LocalSession = {
        ...session,
        agentId: agent.id,
      };

      this.sessions.set(session.sessionId, registered);
      this.callbacks.onSessionDiscovered?.(registered);

      log.info('Registered session', {
        sessionId: session.sessionId.slice(0, 8),
        agentId: agent.id.slice(0, 8),
        sessionName: session.sessionName,
      });
    } catch (err) {
      log.error('Failed to register session', {
        sessionId: session.sessionId.slice(0, 8),
        error: err instanceof Error ? err.message : String(err),
      });
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // --------------------------------------------------------------------------
  // Heartbeat Management
  // --------------------------------------------------------------------------

  private startHeartbeat(sessionId: string, agentId: string): void {
    const registryCleanup = this.registry.startHeartbeatLoop(
      agentId,
      this.config.heartbeatIntervalMs,
    );

    // If JWT is enabled, add a parallel interval that refreshes the token
    let jwtRefreshInterval: ReturnType<typeof setInterval> | null = null;
    if (this.jwtManager && this.currentToken) {
      jwtRefreshInterval = setInterval(() => {
        this.refreshJWTToken();
      }, this.config.heartbeatIntervalMs);
    }

    const cleanup = () => {
      registryCleanup();
      if (jwtRefreshInterval) {
        clearInterval(jwtRefreshInterval);
      }
    };

    this.heartbeats.set(sessionId, cleanup);
    log.debug('Started heartbeat', {
      agentId: agentId.slice(0, 8),
      intervalMs: this.config.heartbeatIntervalMs,
      jwtRefreshEnabled: this.jwtManager !== null,
    });
  }

  /**
   * Attempt to refresh the JWT token. If the token is within the rotation
   * window, a new token is issued and the client header is updated.
   * If the token cannot be refreshed (not in rotation window), no action is taken.
   * If the token is invalid/expired, a brand new token is created.
   */
  private refreshJWTToken(): void {
    if (!this.jwtManager || !this.currentToken) {
      return;
    }

    // Try to refresh within rotation window
    const refreshed = this.jwtManager.refreshToken(this.currentToken);
    if (refreshed) {
      this.currentToken = refreshed;
      this.client.setHeader('X-Agent-Token', refreshed);
      log.debug('JWT token refreshed via rotation');
      return;
    }

    // If refresh failed, check if token is still valid
    const payload = this.jwtManager.validateToken(this.currentToken);
    if (payload) {
      // Token is still valid but not in rotation window yet -- no action needed
      return;
    }

    // Token is expired or invalid -- create a brand new one
    this.currentToken = this.jwtManager.createToken(
      this.config.machineId,
      this.config.machineId,
      ['daemon', 'route', 'heartbeat'],
    );
    this.client.setHeader('X-Agent-Token', this.currentToken);
    log.info('JWT token expired, created new token');
  }

  // --------------------------------------------------------------------------
  // Session Discovery Polling
  // --------------------------------------------------------------------------

  /**
   * Start polling for session changes every 5 seconds.
   * Discovers new sessions and deregisters stale ones.
   * Also checks SSE health on every cycle.
   */
  private startDiscoveryPolling(): void {
    this.discoveryInterval = setInterval(async () => {
      try {
        const discovered = await discoverSessions(this.config.machineId);
        const discoveredIds = new Set(discovered.map(s => s.sessionId));

        // Find new sessions (discovered but not yet registered)
        for (const session of discovered) {
          if (!this.sessions.has(session.sessionId)) {
            log.info('New session discovered', {
              sessionId: session.sessionId.slice(0, 8),
              sessionName: session.sessionName,
            });
            await this.registerSession(session);

            // Start heartbeat for the new session
            const registered = this.sessions.get(session.sessionId);
            if (registered?.agentId) {
              this.startHeartbeat(session.sessionId, registered.agentId);
            }
          }
        }

        // Find stale sessions (registered but no longer discovered)
        for (const [sessionId, session] of this.sessions) {
          if (!discoveredIds.has(sessionId)) {
            log.info('Session stale, removing', {
              sessionId: sessionId.slice(0, 8),
              sessionName: session.sessionName,
            });

            // Stop heartbeat
            const cleanup = this.heartbeats.get(sessionId);
            if (cleanup) {
              cleanup();
              this.heartbeats.delete(sessionId);
            }

            // Deregister agent
            if (session.agentId) {
              try {
                await this.registry.deregister(session.agentId);
              } catch (err) {
                log.warn('Failed to deregister stale agent', {
                  agentId: session.agentId.slice(0, 8),
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            this.sessions.delete(sessionId);
          }
        }

        // Keep RLS filter session IDs in sync
        if (this.rlsFilter) {
          const currentSessionIds = new Set<string>();
          for (const [sid] of this.sessions) {
            currentSessionIds.add(sid);
          }
          this.rlsFilter.updateSessionIds(currentSessionIds);
        }
      } catch (err) {
        log.warn('Discovery polling error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // SSE health check: if disconnected, force reconnect
      if (this.sseClient && !this.sseClient.isConnected) {
        log.warn('SSE disconnected during health check, reconnecting');
        await this.reconnectSSE();
      }
    }, this.discoveryIntervalMs);

    log.info('Started discovery polling', { intervalMs: this.discoveryIntervalMs });
  }

  // --------------------------------------------------------------------------
  // SSE Connection
  // --------------------------------------------------------------------------

  private async connectSSE(): Promise<void> {
    // Build query params to filter for messages targeting this machine's agents
    const queryParams: Record<string, string> = {
      machine_id: this.config.machineId,
    };

    this.sseClient = new SSEClient(
      this.config.apiUrl,
      this.config.projectKey,
      this.config.sse,
      queryParams,
    );

    // Wire up callbacks
    this.sseClient.onMessage((message: Message) => {
      this.handleIncomingMessage(message);
    });

    this.sseClient.onStatus((connected: boolean) => {
      this.callbacks.onSSEStatus?.(connected);
      log.info('SSE status changed', { connected });
    });

    this.sseClient.onError((error: Error) => {
      this.callbacks.onError?.(error);
      log.error('SSE error', { error: error.message });
    });

    try {
      await this.sseClient.connect();
    } catch (err) {
      log.warn('SSE initial connection failed (will auto-reconnect)', {
        error: err instanceof Error ? err.message : String(err),
      });
      // SSE client will auto-reconnect, so don't throw
    }
  }

  /**
   * Force-reconnect the SSE client by disconnecting the old one
   * and creating a fresh connection.
   */
  private async reconnectSSE(): Promise<void> {
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }
    await this.connectSSE();
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleIncomingMessage(message: Message): void {
    log.info('Received message', {
      messageId: message.id.slice(0, 8),
      type: message.messageType,
      senderId: message.senderId.slice(0, 8),
    });

    // Apply client-side RLS filter before any routing
    if (this.rlsFilter && !this.rlsFilter.shouldDeliver(message)) {
      log.info('RLS filter dropped message', {
        messageId: message.id.slice(0, 8),
        targetAddress: message.targetAddress?.slice(0, 20) || '(none)',
        channelId: message.channelId?.slice(0, 8) || '(none)',
      });
      return;
    }

    const deliveryMode = (message.metadata?.deliveryMode as string) || 'push';

    // Branch on delivery mode
    if (deliveryMode === 'broadcast') {
      // Memos: skip routing entirely -- read via REST only
      log.debug('Skipping broadcast message (memo)', { messageId: message.id.slice(0, 8) });
      return;
    }

    if (deliveryMode === 'pull') {
      // Mail: write to local inbox, skip push to session
      try {
        const targetAgentId = this.resolveTargetAgent(message);
        if (targetAgentId) {
          writeToInbox(targetAgentId, message);
          log.info('Wrote pull message to inbox', {
            messageId: message.id.slice(0, 8),
            agentId: targetAgentId.slice(0, 8),
          });
        } else {
          log.warn('No target agent for pull message', {
            messageId: message.id.slice(0, 8),
          });
        }
      } catch (err) {
        log.error('Failed to write to inbox', {
          messageId: message.id.slice(0, 8),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // Push (default): route to session immediately
    const localSessions = Array.from(this.sessions.values());

    // Route asynchronously - don't block the SSE stream
    this.router.route(message, localSessions).then((result) => {
      if (result.ok) {
        this.callbacks.onMessageRouted?.(result);
        log.info('Message routed successfully', { messageId: result.messageId.slice(0, 8) });
      } else {
        this.callbacks.onMessageError?.(result);
        log.warn('Message routing failed', {
          messageId: result.messageId.slice(0, 8),
          error: result.error,
        });
      }
    }).catch((err) => {
      log.error('Unexpected error routing message', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Resolve the target agent ID from message target address.
   */
  private resolveTargetAgent(message: Message): string | null {
    // Try to find a matching local session by target address
    for (const session of this.sessions.values()) {
      if (message.targetAddress?.includes(session.sessionId || '')) {
        return session.agentId || null;
      }
    }
    // Fall back to first registered agent
    const firstSession = this.sessions.values().next();
    if (!firstSession.done && firstSession.value) {
      return firstSession.value.agentId || null;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Signal Handling
  // --------------------------------------------------------------------------

  private installSignalHandlers(): void {
    const handleShutdown = () => {
      log.info('Shutdown signal received');
      this.stop().catch((err) => {
        console.error('Error during shutdown:', err);
      }).finally(() => {
        process.exit(0);
      });
    };

    // SIGINT (Ctrl+C)
    const sigintHandler = () => handleShutdown();
    process.on('SIGINT', sigintHandler);
    this.signalHandlers.push({ signal: 'SIGINT', handler: sigintHandler });

    // SIGTERM (kill)
    const sigtermHandler = () => handleShutdown();
    process.on('SIGTERM', sigtermHandler);
    this.signalHandlers.push({ signal: 'SIGTERM', handler: sigtermHandler });
  }

  private removeSignalHandlers(): void {
    for (let i = 0; i < this.signalHandlers.length; i++) {
      const { signal, handler } = this.signalHandlers[i]!;
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  private setState(newState: DaemonState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      log.debug('State changed', { from: oldState, to: newState });
      this.callbacks.onStateChange?.(newState);
    }
  }
}
