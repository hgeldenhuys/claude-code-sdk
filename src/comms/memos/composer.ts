/**
 * MemoComposer - Builds and sends memo messages
 *
 * Converts MemoCompose input into MessageSend payloads,
 * storing subject/category/priority in message metadata.
 */

import type { Message, MessageSend } from '../protocol/types';
import type { SignalDBClient } from '../client/signaldb';
import { parseAddress } from '../protocol/address';
import type { MemoCategory, MemoCompose, MemoConfig, MemoPriority, MemoView } from './types';

export class MemoComposer {
  private readonly client: SignalDBClient;
  private readonly config: MemoConfig;

  constructor(client: SignalDBClient, config: MemoConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Compose a MemoCompose into a MessageSend payload.
   * Does NOT send - use send() for that.
   */
  compose(memo: MemoCompose): MessageSend {
    // Validate required fields
    if (!memo.subject || memo.subject.trim() === '') {
      throw new Error('Memo subject is required');
    }
    if (!memo.body || memo.body.trim() === '') {
      throw new Error('Memo body is required');
    }
    if (!memo.to || memo.to.trim() === '') {
      throw new Error('Memo address (to) is required');
    }

    // Validate address format
    const parsed = parseAddress(memo.to);

    // Determine target type and address
    const targetType = parsed.type;
    const targetAddress = memo.to;

    // Build metadata
    const category: MemoCategory = memo.category ?? this.config.defaultCategory ?? 'knowledge';
    const priority: MemoPriority = memo.priority ?? this.config.defaultPriority ?? 'P2';

    const metadata: Record<string, unknown> = {
      subject: memo.subject,
      category,
      priority,
      ...(memo.metadata ?? {}),
    };

    // Calculate expiresAt from expiresIn
    let expiresAt: string | undefined;
    if (memo.expiresIn !== undefined && memo.expiresIn > 0) {
      const expDate = new Date(Date.now() + memo.expiresIn * 1000);
      expiresAt = expDate.toISOString();
    }

    const channelId = this.config.channelId ?? 'default';

    return {
      channelId,
      senderId: this.config.agentId,
      targetType,
      targetAddress,
      messageType: 'memo',
      content: memo.body,
      metadata,
      threadId: memo.threadId,
      expiresAt,
    };
  }

  /**
   * Compose and send a memo.
   */
  async send(memo: MemoCompose): Promise<MemoView> {
    const payload = this.compose(memo);
    const message = await this.client.messages.send(payload);
    return messageToMemoView(message);
  }
}

/**
 * Convert a raw Message to a MemoView by extracting metadata fields.
 */
export function messageToMemoView(msg: Message): MemoView {
  const meta = msg.metadata ?? {};
  return {
    id: msg.id,
    senderId: msg.senderId,
    to: msg.targetAddress,
    subject: (meta.subject as string) ?? '(no subject)',
    body: msg.content,
    category: (meta.category as MemoCategory) ?? 'knowledge',
    priority: (meta.priority as MemoPriority) ?? 'P2',
    status: msg.status,
    claimedBy: msg.claimedBy,
    threadId: msg.threadId,
    createdAt: msg.createdAt,
    expiresAt: msg.expiresAt,
    metadata: meta,
  };
}
