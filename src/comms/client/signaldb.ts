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
// Case Conversion Utilities
// ============================================================================

/**
 * Convert snake_case string to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Field aliases for type compatibility.
 * SignalDB uses different field names than our protocol types.
 */
const FIELD_ALIASES: Record<string, string> = {
  createdAt: 'registeredAt', // Agent.registeredAt <- created_at
};

/**
 * Convert all keys in an object from snake_case to camelCase (recursive).
 * Also applies field aliases for type compatibility.
 */
function convertKeysToCamelCase<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => convertKeysToCamelCase(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      let camelKey = snakeToCamel(key);
      // Apply field alias if exists
      if (FIELD_ALIASES[camelKey]) {
        camelKey = FIELD_ALIASES[camelKey];
      }
      result[camelKey] = convertKeysToCamelCase((obj as Record<string, unknown>)[key]);
    }
    return result as T;
  }

  return obj as T;
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
  /** Optional extra headers to include in every request (e.g. X-Agent-Token) */
  extraHeaders?: Record<string, string>;
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
  private extraHeaders: Record<string, string>;

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
    this.extraHeaders = config.extraHeaders ? { ...config.extraHeaders } : {};

    this.agents = new AgentOperations(this);
    this.channels = new ChannelOperations(this);
    this.messages = new MessageOperations(this);
    this.pastes = new PasteOperations(this);
  }

  /**
   * Set an extra header to include in all subsequent requests.
   * Use this for JWT token attachment and refresh.
   */
  setHeader(name: string, value: string): void {
    this.extraHeaders[name] = value;
  }

  /**
   * Remove an extra header.
   */
  removeHeader(name: string): void {
    delete this.extraHeaders[name];
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
      ...this.extraHeaders,
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

    const json = await response.json();

    // SignalDB wraps list responses in { data: [...], meta: {...} }
    // Unwrap if we detect this format
    if (json && typeof json === 'object' && 'data' in json && Array.isArray(json.data)) {
      return convertKeysToCamelCase<T>(json.data);
    }

    // Convert snake_case keys to camelCase
    return convertKeysToCamelCase<T>(json);
  }
}

// ============================================================================
// Agent Operations
// ============================================================================

class AgentOperations {
  constructor(private readonly client: SignalDBClient) {}

  /**
   * Register a new agent in the system.
   * Sets initial heartbeat and active status.
   */
  async register(data: AgentRegistration): Promise<Agent> {
    // Convert camelCase to snake_case for SignalDB (only send snake_case keys)
    return this.client.request<Agent>('POST', '/v1/agents', {
      machine_id: data.machineId,
      session_id: data.sessionId,
      session_name: data.sessionName,
      project_path: data.projectPath,
      capabilities: data.capabilities ?? {},
      metadata: data.metadata ?? {},
      // Set initial status and heartbeat
      status: 'active',
      heartbeat_at: new Date().toISOString(),
    });
  }

  /**
   * Remove an agent from the registry.
   */
  async deregister(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/v1/agents/${id}`);
  }

  /**
   * Update an agent's heartbeat timestamp.
   * Uses PATCH for partial update to preserve other fields.
   */
  async heartbeat(id: string): Promise<Agent> {
    return this.client.request<Agent>('PATCH', `/v1/agents/${id}`, {
      heartbeat_at: new Date().toISOString(),
      status: 'active',
    });
  }

  /**
   * Find agents by machine ID.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async findByMachineId(machineId: string): Promise<Agent[]> {
    const agents = await this.list();
    return agents.filter(a => a.machineId === machineId);
  }

  /**
   * Find an agent by session ID.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async findBySessionId(sessionId: string): Promise<Agent[]> {
    const agents = await this.list();
    return agents.filter(a => a.sessionId === sessionId);
  }

  /**
   * List agents with optional filters.
   * Note: SignalDB only supports limit/offset/orderBy/order params.
   * All other filters are applied client-side.
   */
  async list(filters?: AgentFilter): Promise<Agent[]> {
    // SignalDB only supports pagination params, not column filters
    const agents = await this.client.request<Agent[]>('GET', '/v1/agents');

    if (!filters) {
      return agents;
    }

    // Apply filters client-side
    return agents.filter(agent => {
      if (filters.machineId && agent.machineId !== filters.machineId) return false;
      if (filters.sessionId && agent.sessionId !== filters.sessionId) return false;
      if (filters.projectPath && agent.projectPath !== filters.projectPath) return false;
      if (filters.status && agent.status !== filters.status) return false;
      return true;
    });
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
    // Convert camelCase to snake_case for SignalDB
    return this.client.request<Channel>('POST', '/v1/channels', {
      name: data.name,
      type: data.type,
      members: data.members ?? [],
      created_by: data.createdBy,
      metadata: data.metadata ?? {},
    });
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
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async list(filters?: ChannelFilter): Promise<Channel[]> {
    const channels = await this.client.request<Channel[]>('GET', '/v1/channels');

    if (!filters) {
      return channels;
    }

    // Apply filters client-side
    return channels.filter(channel => {
      if (filters.type && channel.type !== filters.type) return false;
      if (filters.name && channel.name !== filters.name) return false;
      return true;
    });
  }

  /**
   * Add a member to a channel.
   * Note: SignalDB doesn't have a /members endpoint, so we use PUT to update the channel.
   */
  async addMember(channelId: string, agentId: string): Promise<Channel> {
    // First get the current channel to get existing members
    const channel = await this.get(channelId);
    const members = channel.members || [];

    // Add the new member if not already present
    if (!members.includes(agentId)) {
      members.push(agentId);
    }

    // Update the channel with new members list
    return this.client.request<Channel>('PUT', `/v1/channels/${channelId}`, {
      members,
    });
  }

  /**
   * Remove a member from a channel.
   * Note: SignalDB doesn't have a /members endpoint, so we use PUT to update the channel.
   */
  async removeMember(channelId: string, agentId: string): Promise<Channel> {
    // First get the current channel
    const channel = await this.get(channelId);
    const members = (channel.members || []).filter(id => id !== agentId);

    // Update the channel with filtered members list
    return this.client.request<Channel>('PUT', `/v1/channels/${channelId}`, {
      members,
    });
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
    // Convert camelCase to snake_case for SignalDB
    return this.client.request<Message>('POST', '/v1/messages', {
      channel_id: data.channelId,
      sender_id: data.senderId,
      target_type: data.targetType,
      target_address: data.targetAddress,
      message_type: data.messageType,
      content: data.content,
      metadata_json: data.metadata ?? {},
      status: 'pending',
      thread_id: data.threadId,
    });
  }

  /**
   * Claim a pending message for processing.
   * Note: SignalDB doesn't have a /claim endpoint, so we use PUT.
   * We first GET the message to preserve all existing fields.
   */
  async claim(id: string, agentId: string): Promise<Message> {
    // Get the existing message to preserve all fields
    const existing = await this.client.request<Message>('GET', `/v1/messages/${id}`);

    // Update with claim info while preserving all existing fields
    return this.client.request<Message>('PUT', `/v1/messages/${id}`, {
      channel_id: existing.channelId,
      sender_id: existing.senderId,
      target_type: existing.targetType,
      target_address: existing.targetAddress,
      message_type: existing.messageType,
      content: existing.content,
      metadata_json: existing.metadata ?? {},
      thread_id: existing.threadId,
      claimed_by: agentId,
      claimed_at: new Date().toISOString(),
      status: 'claimed',
    });
  }

  /**
   * Update a message's delivery status.
   * Note: SignalDB doesn't have a /status endpoint, so we use PUT.
   * We first GET the message to preserve all existing fields.
   */
  async updateStatus(id: string, status: MessageStatus): Promise<Message> {
    // Get the existing message to preserve all fields
    const existing = await this.client.request<Message>('GET', `/v1/messages/${id}`);

    // Update status while preserving all existing fields
    return this.client.request<Message>('PUT', `/v1/messages/${id}`, {
      channel_id: existing.channelId,
      sender_id: existing.senderId,
      target_type: existing.targetType,
      target_address: existing.targetAddress,
      message_type: existing.messageType,
      content: existing.content,
      metadata_json: existing.metadata ?? {},
      thread_id: existing.threadId,
      claimed_by: existing.claimedBy,
      claimed_at: existing.claimedAt,
      status,
    });
  }

  /**
   * List all messages.
   * Note: Requests a higher limit since SignalDB's default is 100.
   */
  async list(): Promise<Message[]> {
    return this.client.request<Message[]>('GET', '/v1/messages', undefined, {
      limit: '500',
      orderBy: 'created_at',
      order: 'desc',
    });
  }

  /**
   * List messages by channel with optional filters.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async listByChannel(channelId: string, filters?: MessageFilter): Promise<Message[]> {
    const messages = await this.list();

    return messages.filter(msg => {
      if (msg.channelId !== channelId) return false;
      if (filters?.status && msg.status !== filters.status) return false;
      if (filters?.messageType && msg.messageType !== filters.messageType) return false;
      return true;
    });
  }

  /**
   * List messages targeted at a specific agent.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   * Matches messages where the agent is either the sender or recipient.
   *
   * @param agentId The database ID of the agent
   * @param filters Optional message filters
   * @param sessionId Optional session ID to match in targetAddress (needed since targetAddress uses sessionId, not database ID)
   */
  async listForAgent(agentId: string, filters?: MessageFilter, sessionId?: string): Promise<Message[]> {
    const messages = await this.list();

    return messages.filter(msg => {
      // Match by sender OR target address containing agent ID or session info
      // The targetAddress format is: agent://{machineId}/{sessionId}
      const isRecipient = msg.targetAddress?.includes(agentId) ||
        (sessionId && msg.targetAddress?.includes(sessionId));
      const isSender = msg.senderId === agentId;

      if (!isRecipient && !isSender) return false;
      if (filters?.status && msg.status !== filters.status) return false;
      if (filters?.messageType && msg.messageType !== filters.messageType) return false;
      return true;
    });
  }

  /**
   * List messages in a conversation thread.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async listByThread(threadId: string): Promise<Message[]> {
    const messages = await this.list();
    return messages.filter(msg => msg.threadId === threadId);
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
    // Calculate expires_at for TTL pastes
    let expiresAt: string | undefined;
    if (data.accessType === 'ttl' && data.ttlSeconds) {
      const expiry = new Date();
      expiry.setSeconds(expiry.getSeconds() + data.ttlSeconds);
      expiresAt = expiry.toISOString();
    }

    // Convert camelCase to snake_case for SignalDB
    return this.client.request<Paste>('POST', '/v1/pastes', {
      creator_id: data.creatorId,
      content: data.content,
      content_type: data.contentType ?? 'text/plain',
      access_type: data.accessType,
      ttl_seconds: data.ttlSeconds,
      recipient_id: data.recipientId,
      expires_at: expiresAt,
    });
  }

  /**
   * Read a paste.
   * Note: For read_once pastes, we need to update the paste after reading.
   * For TTL pastes, we check expiration client-side since SignalDB doesn't enforce it.
   */
  async read(id: string, readerId: string): Promise<Paste> {
    // First get the paste
    const paste = await this.client.request<Paste>('GET', `/v1/pastes/${id}`);

    // Normalize readBy to always be an array
    if (!paste.readBy) {
      paste.readBy = [];
    } else if (!Array.isArray(paste.readBy)) {
      paste.readBy = [paste.readBy as unknown as string];
    }

    // Check if TTL paste is expired (client-side enforcement)
    if (paste.accessType === 'ttl' && paste.expiresAt) {
      const expiresAt = new Date(paste.expiresAt);
      if (expiresAt <= new Date()) {
        // Return paste with deleted indicator
        paste.content = '';
        paste.deletedAt = new Date().toISOString();
        return paste;
      }
    }

    // If read_once, mark as read and return original content
    if (paste.accessType === 'read_once' && !paste.readAt) {
      // Update the paste to mark as read
      await this.client.request<Paste>('PUT', `/v1/pastes/${id}`, {
        read_at: new Date().toISOString(),
        read_by: [readerId],
      });
      // Return the original paste content with read info
      // (PUT may return partial data, so we use the original content)
      paste.readAt = new Date().toISOString();
      paste.readBy = [readerId];
      return paste;
    }

    // If read_once and already read, return empty content
    if (paste.accessType === 'read_once' && paste.readAt) {
      paste.content = '';
      paste.deletedAt = paste.readAt;
      return paste;
    }

    return paste;
  }

  /**
   * Delete a paste.
   */
  async delete(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/v1/pastes/${id}`);
  }

  /**
   * List all pastes.
   */
  async list(): Promise<Paste[]> {
    return this.client.request<Paste[]>('GET', '/v1/pastes');
  }

  /**
   * List pastes created by or addressed to an agent.
   * Note: SignalDB doesn't support server-side filtering, so we filter client-side.
   */
  async listForAgent(agentId: string): Promise<Paste[]> {
    const pastes = await this.list();
    return pastes.filter(paste =>
      paste.creatorId === agentId || paste.recipientId === agentId,
    );
  }
}
