/**
 * MemoComposer - Builds and sends memo messages
 *
 * Converts MemoCompose input into MessageSend payloads.
 * Encodes subject/category/priority as a structured header in the content
 * field because SignalDB does not persist metadata_json on INSERT.
 *
 * Envelope format (prepended to content):
 *   <!--memo:subject=...;category=...;priority=...-->
 *
 * This is parsed back out by messageToMemoView().
 */

import type { Message, MessageSend } from '../protocol/types';
import type { SignalDBClient } from '../client/signaldb';
import { parseAddress } from '../protocol/address';
import type { MemoCategory, MemoCompose, MemoConfig, MemoPriority, MemoView } from './types';

// ============================================================================
// Envelope Encoding/Decoding
// ============================================================================

/** Envelope prefix marker */
const ENVELOPE_PREFIX = '<!--memo:';
const ENVELOPE_SUFFIX = '-->\n';

/**
 * Encode memo metadata into an envelope header string.
 * Format: <!--memo:subject=...;category=...;priority=...-->
 */
function encodeEnvelope(subject: string, category: MemoCategory, priority: MemoPriority): string {
  // Escape semicolons and newlines in subject to avoid breaking the format
  const safeSubject = subject.replace(/;/g, '&#59;').replace(/\n/g, '&#10;');
  return `${ENVELOPE_PREFIX}subject=${safeSubject};category=${category};priority=${priority}${ENVELOPE_SUFFIX}`;
}

/**
 * Decode memo metadata from content that may have an envelope header.
 * Returns the extracted metadata and the clean body (without envelope).
 */
function decodeEnvelope(content: string): {
  subject: string | null;
  category: MemoCategory | null;
  priority: MemoPriority | null;
  body: string;
} {
  if (!content.startsWith(ENVELOPE_PREFIX)) {
    return { subject: null, category: null, priority: null, body: content };
  }

  const endIdx = content.indexOf(ENVELOPE_SUFFIX);
  if (endIdx === -1) {
    return { subject: null, category: null, priority: null, body: content };
  }

  const headerContent = content.slice(ENVELOPE_PREFIX.length, endIdx);
  const body = content.slice(endIdx + ENVELOPE_SUFFIX.length);

  let subject: string | null = null;
  let category: MemoCategory | null = null;
  let priority: MemoPriority | null = null;

  const parts = headerContent.split(';');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);

    switch (key) {
      case 'subject':
        subject = value.replace(/&#59;/g, ';').replace(/&#10;/g, '\n');
        break;
      case 'category':
        category = value as MemoCategory;
        break;
      case 'priority':
        priority = value as MemoPriority;
        break;
    }
  }

  return { subject, category, priority, body };
}

// ============================================================================
// MemoComposer
// ============================================================================

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

    // Encode metadata as envelope in content (SignalDB doesn't persist metadata_json)
    const envelope = encodeEnvelope(memo.subject, category, priority);
    const content = envelope + memo.body;

    return {
      channelId,
      senderId: this.config.agentId,
      targetType,
      targetAddress,
      messageType: 'memo',
      content,
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
 *
 * Resolution order for subject/category/priority:
 * 1. Envelope header in content (reliable — persisted in content field)
 * 2. metadata_json from API (unreliable — SignalDB doesn't persist on INSERT)
 * 3. Fallback defaults
 */
export function messageToMemoView(msg: Message): MemoView {
  const meta = msg.metadata ?? {};

  // Try envelope first (reliable)
  const envelope = decodeEnvelope(msg.content);

  const subject = envelope.subject ?? (meta.subject as string) ?? '(no subject)';
  const category = envelope.category ?? (meta.category as MemoCategory) ?? 'knowledge';
  const priority = envelope.priority ?? (meta.priority as MemoPriority) ?? 'P2';
  const body = envelope.subject ? envelope.body : msg.content;

  return {
    id: msg.id,
    senderId: msg.senderId,
    to: msg.targetAddress,
    subject,
    body,
    category,
    priority,
    status: msg.status,
    claimedBy: msg.claimedBy,
    threadId: msg.threadId,
    createdAt: msg.createdAt,
    expiresAt: msg.expiresAt,
    metadata: meta,
  };
}
