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
 * 6. Graceful shutdown on SIGINT/SIGTERM
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SignalDBClient } from '../client/signaldb';
import { AgentRegistry } from '../registry/agent-registry';
import type { Message } from '../protocol/types';
import { discoverSessions } from './session-discovery';
import { SSEClient } from './sse-client';
import { MessageRouter } from './message-router';
import type {
  DaemonConfig,
  DaemonState,
  DaemonCallbacks,
  LocalSession,
} from './types';

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

  constructor(
    client: SignalDBClient,
    config: DaemonConfig,
    callbacks?: DaemonCallbacks,
  ) {
    this.client = client;
    this.config = config;
    this.registry = new AgentRegistry(client);
    this.router = new MessageRouter(client);
    this.callbacks = callbacks ?? {};
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

    try {
      // 1. Install signal handlers
      this.installSignalHandlers();

      // 2. Discover local sessions
      const discovered = await discoverSessions(this.config.machineId);

      if (discovered.length === 0) {
        this.log('No active Claude Code sessions found');
      } else {
        this.log(`Discovered ${discovered.length} active session(s)`);
      }

      // 3. Register each session in SignalDB
      for (let i = 0; i < discovered.length; i++) {
        const session = discovered[i]!;
        await this.registerSession(session);
      }

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
      this.log('Daemon running');
    } catch (err) {
      this.setState('error');
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`Startup failed: ${error.message}`);
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

    // 2. Stop all heartbeat loops
    for (const [sessionId, cleanup] of this.heartbeats) {
      cleanup();
      this.log(`Stopped heartbeat for session ${sessionId.slice(0, 8)}`);
    }
    this.heartbeats.clear();

    // 3. Deregister all agents from SignalDB
    for (const [sessionId, session] of this.sessions) {
      if (session.agentId) {
        try {
          await this.registry.deregister(session.agentId);
          this.log(`Deregistered agent ${session.agentId.slice(0, 8)} for session ${sessionId.slice(0, 8)}`);
        } catch (err) {
          this.log(`Failed to deregister ${session.agentId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    this.sessions.clear();

    // 4. Remove signal handlers
    this.removeSignalHandlers();

    this.setState('stopped');
    this.log('Daemon stopped');
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

      this.log(`Registered session ${session.sessionId.slice(0, 8)} as agent ${agent.id.slice(0, 8)}`);
    } catch (err) {
      this.log(`Failed to register session ${session.sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // --------------------------------------------------------------------------
  // Heartbeat Management
  // --------------------------------------------------------------------------

  private startHeartbeat(sessionId: string, agentId: string): void {
    const cleanup = this.registry.startHeartbeatLoop(
      agentId,
      this.config.heartbeatIntervalMs,
    );

    this.heartbeats.set(sessionId, cleanup);
    this.log(`Started heartbeat for agent ${agentId.slice(0, 8)} (interval: ${this.config.heartbeatIntervalMs}ms)`);
  }

  // --------------------------------------------------------------------------
  // Session Discovery Polling
  // --------------------------------------------------------------------------

  /**
   * Start polling for session changes every 5 seconds.
   * Discovers new sessions and deregisters stale ones.
   */
  private startDiscoveryPolling(): void {
    this.discoveryInterval = setInterval(async () => {
      try {
        const discovered = await discoverSessions(this.config.machineId);
        const discoveredIds = new Set(discovered.map(s => s.sessionId));

        // Find new sessions (discovered but not yet registered)
        for (const session of discovered) {
          if (!this.sessions.has(session.sessionId)) {
            this.log(`New session: ${session.sessionId.slice(0, 8)} (${session.sessionName ?? 'unnamed'})`);
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
            this.log(`Session stale: ${sessionId.slice(0, 8)} (${session.sessionName ?? 'unnamed'})`);

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
              } catch {
                // Ignore deregistration errors
              }
            }

            this.sessions.delete(sessionId);
          }
        }
      } catch {
        // Silently ignore polling errors - next poll will retry
      }
    }, this.discoveryIntervalMs);

    this.log(`Started discovery polling (${this.discoveryIntervalMs}ms)`);
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
      this.log(`SSE ${connected ? 'connected' : 'disconnected'}`);
    });

    this.sseClient.onError((error: Error) => {
      this.callbacks.onError?.(error);
      this.log(`SSE error: ${error.message}`);
    });

    try {
      await this.sseClient.connect();
    } catch (err) {
      this.log(`SSE initial connection failed: ${err instanceof Error ? err.message : String(err)}`);
      // SSE client will auto-reconnect, so don't throw
    }
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleIncomingMessage(message: Message): void {
    this.log(`Received message ${message.id.slice(0, 8)} (type: ${message.messageType})`);

    const localSessions = Array.from(this.sessions.values());

    // Route asynchronously - don't block the SSE stream
    this.router.route(message, localSessions).then((result) => {
      if (result.ok) {
        this.callbacks.onMessageRouted?.(result);
        this.log(`Routed message ${result.messageId.slice(0, 8)} successfully`);
      } else {
        this.callbacks.onMessageError?.(result);
        this.log(`Failed to route message ${result.messageId.slice(0, 8)}: ${result.error}`);
      }
    }).catch((err) => {
      this.log(`Unexpected error routing message: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // --------------------------------------------------------------------------
  // Signal Handling
  // --------------------------------------------------------------------------

  private installSignalHandlers(): void {
    const handleShutdown = () => {
      this.log('Shutdown signal received');
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
      this.callbacks.onStateChange?.(newState);
    }
  }

  // --------------------------------------------------------------------------
  // Logging
  // --------------------------------------------------------------------------

  private log(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] [daemon] ${message}`);
  }
}
