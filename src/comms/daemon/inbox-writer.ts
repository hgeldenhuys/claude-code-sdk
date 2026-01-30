/**
 * Inbox Writer
 *
 * Appends pull-mode messages to local inbox files for later retrieval.
 * Messages are stored as JSONL in ~/.claude/comms/inbox/<agentId>.jsonl
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Message } from "../protocol/types";

const INBOX_DIR = join(homedir(), ".claude", "comms", "inbox");

/**
 * Ensure the inbox directory exists.
 */
function ensureInboxDir(): void {
  if (!existsSync(INBOX_DIR)) {
    mkdirSync(INBOX_DIR, { recursive: true });
  }
}

/**
 * Write a pull-mode message to the agent's local inbox.
 */
export function writeToInbox(agentId: string, message: Message): void {
  ensureInboxDir();

  const inboxPath = join(INBOX_DIR, `${agentId}.jsonl`);
  const entry = JSON.stringify({
    id: message.id,
    senderId: message.senderId,
    content: message.content,
    messageType: message.messageType,
    metadata: message.metadata || {},
    threadId: message.threadId || null,
    createdAt: message.createdAt,
    receivedAt: new Date().toISOString(),
  });

  appendFileSync(inboxPath, `${entry}\n`, "utf-8");
}

/**
 * Get the inbox file path for an agent.
 */
export function getInboxPath(agentId: string): string {
  return join(INBOX_DIR, `${agentId}.jsonl`);
}
