/**
 * SignalDB REST Client
 *
 * Typed HTTP client for the SignalDB.live API.
 * Provides CRUD operations for agents, channels, messages, and pastes.
 */

import type {
  Agent,
  AgentFilter,
  AgentRegistration,
  Channel,
  ChannelCreate,
  ChannelFilter,
  Message,
  MessageFilter,
  MessageSend,
  MessageStatus,
  Paste,
  PasteCreate,
} from '../protocol/types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown by SignalDB API operations.
 */
export class SignalDBError extends Error {
  readonly statusCode: number;
  readonly endpoint: string;

  constructor(statusCode: number, message: string, endpoint: string) {
    super(`SignalDB error ${statusCode} at ${endpoint}: ${message}`);
    this.name = 'SignalDBError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Configuration for the SignalDB REST client.
 */
export interface SignalDBClientConfig {
  /** Base URL for the SignalDB API (e.g. "https://your-project.signaldb.live") */
  apiUrl: string;
  /** Project API key for authentication */
  projectKey: string;
}

// ============================================================================
// Client Implementation
// ============================================================================

/**
 * Typed REST client for the SignalDB.live API.
 *
 * @example
 * ```typescript
 * const client = new SignalDBClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 * });
 *
 * const agent = await client.agents.register({
 *   machineId: 'mac-001',
 *   sessionId: 'abc-123',
 * });
 * ```
 */
export class SignalDBClient {
  private readonly apiUrl: string;
  private readonly projectKey: string;

  /** Agent CRUD operations */
  readonly agents: AgentOperations;
  /** Channel CRUD operations */
  readonly channels: ChannelOperations;
  /** Message CRUD operations */
  readonly messages: MessageOperations;
  /** Paste CRUD operations */
  readonly pastes: PasteOperations;

  constructor(config: SignalDBClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.projectKey = config.projectKey;

    this.agents = new AgentOperations(this);
    this.channels = new ChannelOperations(this);
    this.messages = new MessageOperations(this);
    this.pastes = new PasteOperations(this);
  }

  /**
   * Internal HTTP request helper with typed responses.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | undefined>
  ): Promise<T> {
    let url = `${this.apiUrl}${path}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const key of Object.keys(queryParams)) {
        const value = queryParams[key];
        if (value !== undefined) {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.projectKey}`,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as { message?: string; error?: string };
        errorMessage = errorBody.message ?? errorBody.error ?? response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      throw new SignalDBError(response.status, errorMessage, `${method} ${path}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}

// ============================================================================
// Agent Operations
// ============================================================================

class AgentOperations {
  constructor(private readonly client: SignalDBClient) {}

  /**
   * Register a new agent in the system.
   */
  async register(data: AgentRegistration): Promise<Agent> {
    return this.client.request<Agent>('POST', '/v1/agents', data);
  }

  /**
   * Remove an agent from the registry.
   */
  async deregister(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/v1/agents/${id}`);
  }

  /**
   * Update an agent's heartbeat timestamp.
   */
  async heartbeat(id: string): Promise<Agent> {
    return this.client.request<Agent>('PATCH', `/v1/agents/${id}/heartbeat`);
  }

  /**
   * Find agents by machine ID.
   */
  async findByMachineId(machineId: string): Promise<Agent[]> {
    return this.client.request<Agent[]>('GET', '/v1/agents', undefined, {
      machine_id: machineId,
    });
  }

  /**
   * Find an agent by session ID.
   */
  async findBySessionId(sessionId: string): Promise<Agent[]> {
    return this.client.request<Agent[]>('GET', '/v1/agents', undefined, {
      session_id: sessionId,
    });
  }

  /**
   * List agents with optional filters.
   */
  async list(filters?: AgentFilter): Promise<Agent[]> {
    const params: Record<string, string | undefined> = {};
    if (filters) {
      if (filters.machineId) params.machine_id = filters.machineId;
      if (filters.sessionId) params.session_id = filters.sessionId;
      if (filters.projectPath) params.project_path = filters.projectPath;
      if (filters.status) params.status = filters.status;
    }
    return this.client.request<Agent[]>('GET', '/v1/agents', undefined, params);
  }
}

// ============================================================================
// Channel Operations
// ============================================================================

class ChannelOperations {
  constructor(private readonly client: SignalDBClient) {}

  /**
   * Create a new channel.
   */
  async create(data: ChannelCreate): Promise<Channel> {
    return this.client.request<Channel>('POST', '/v1/channels', data);
  }

  /**
   * Get a channel by ID.
   */
  async get(id: string): Promise<Channel> {
    return this.client.request<Channel>('GET', `/v1/channels/${id}`);
  }

  /**
   * Get a channel by name.
   */
  async getByName(name: string): Promise<Channel> {
    return this.client.request<Channel>('GET', '/v1/channels', undefined, {
      name,
    }) as Promise<Channel>;
  }

  /**
   * List channels with optional filters.
   */
  async list(filters?: ChannelFilter): Promise<Channel[]> {
    const params: Record<string, string | undefined> = {};
    if (filters) {
      if (filters.type) params.type = filters.type;
      if (filters.name) params.name = filters.name;
    }
    return this.client.request<Channel[]>('GET', '/v1/channels', undefined, params);
  }

  /**
   * Add a member to a channel.
   */
  async addMember(channelId: string, agentId: string): Promise<Channel> {
    return this.client.request<Channel>('POST', `/v1/channels/${channelId}/members`, { agentId });
  }

  /**
   * Remove a member from a channel.
   */
  async removeMember(channelId: string, agentId: string): Promise<Channel> {
    return this.client.request<Channel>('DELETE', `/v1/channels/${channelId}/members/${agentId}`);
  }
}

// ============================================================================
// Message Operations
// ============================================================================

class MessageOperations {
  constructor(private readonly client: SignalDBClient) {}

  /**
   * Send a new message.
   */
  async send(data: MessageSend): Promise<Message> {
    return this.client.request<Message>('POST', '/v1/messages', data);
  }

  /**
   * Claim a pending message for processing.
   */
  async claim(id: string, agentId: string): Promise<Message> {
    return this.client.request<Message>('PATCH', `/v1/messages/${id}/claim`, {
      agentId,
    });
  }

  /**
   * Update a message's delivery status.
   */
  async updateStatus(id: string, status: MessageStatus): Promise<Message> {
    return this.client.request<Message>('PATCH', `/v1/messages/${id}/status`, {
      status,
    });
  }

  /**
   * List messages by channel with optional filters.
   */
  async listByChannel(channelId: string, filters?: MessageFilter): Promise<Message[]> {
    const params: Record<string, string | undefined> = {
      channel_id: channelId,
    };
    if (filters) {
      if (filters.status) params.status = filters.status;
      if (filters.messageType) params.message_type = filters.messageType;
      if (filters.limit !== undefined) params.limit = String(filters.limit);
      if (filters.offset !== undefined) params.offset = String(filters.offset);
    }
    return this.client.request<Message[]>('GET', '/v1/messages', undefined, params);
  }

  /**
   * List messages targeted at a specific agent.
   */
  async listForAgent(agentId: string, filters?: MessageFilter): Promise<Message[]> {
    const params: Record<string, string | undefined> = {
      target_agent_id: agentId,
    };
    if (filters) {
      if (filters.status) params.status = filters.status;
      if (filters.messageType) params.message_type = filters.messageType;
      if (filters.limit !== undefined) params.limit = String(filters.limit);
      if (filters.offset !== undefined) params.offset = String(filters.offset);
    }
    return this.client.request<Message[]>('GET', '/v1/messages', undefined, params);
  }

  /**
   * List messages in a conversation thread.
   */
  async listByThread(threadId: string): Promise<Message[]> {
    return this.client.request<Message[]>('GET', '/v1/messages', undefined, {
      thread_id: threadId,
    });
  }
}

// ============================================================================
// Paste Operations
// ============================================================================

class PasteOperations {
  constructor(private readonly client: SignalDBClient) {}

  /**
   * Create a new paste.
   */
  async create(data: PasteCreate): Promise<Paste> {
    return this.client.request<Paste>('POST', '/v1/pastes', data);
  }

  /**
   * Read a paste (marks as read for read_once pastes).
   */
  async read(id: string, readerId: string): Promise<Paste> {
    return this.client.request<Paste>('GET', `/v1/pastes/${id}`, undefined, {
      reader_id: readerId,
    });
  }

  /**
   * Delete a paste.
   */
  async delete(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/v1/pastes/${id}`);
  }

  /**
   * List pastes created by or addressed to an agent.
   */
  async listForAgent(agentId: string): Promise<Paste[]> {
    return this.client.request<Paste[]>('GET', '/v1/pastes', undefined, {
      agent_id: agentId,
    });
  }
}
