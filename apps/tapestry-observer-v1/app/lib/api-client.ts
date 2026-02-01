/**
 * API Client
 *
 * Functions for sending messages and managing channels via the BFF proxy.
 * No API keys are sent from the browser — the proxy injects credentials.
 */

const BASE_URL = "/api/proxy";

/**
 * Send a message through the BFF proxy.
 */
export async function sendMessage(payload: {
  channelId?: string;
  senderId: string;
  targetType: string;
  targetAddress: string;
  messageType: string;
  content: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
}): Promise<{ id: string }> {
  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel_id: payload.channelId || "",
      sender_id: payload.senderId,
      target_type: payload.targetType,
      target_address: payload.targetAddress,
      message_type: payload.messageType,
      content: payload.content,
      metadata: payload.metadata || {},
      thread_id: payload.threadId || null,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send message: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Create a new channel through the BFF proxy.
 */
export async function createChannel(payload: {
  name: string;
  type: string;
  members?: string[];
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const response = await fetch(`${BASE_URL}/v1/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      type: payload.type,
      members: payload.members || [],
      created_by: payload.createdBy || null,
      metadata: payload.metadata || {},
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create channel: ${response.status} ${text}`);
  }

  return response.json();
}
