/**
 * Send Subcommand
 *
 * Send a message to a target address with support for piping.
 *
 * Usage:
 *   comms send <address> <message> [--json]
 *   echo "message" | comms send <address> [--json]
 *
 * Address formats:
 *   broadcast://channel-name  - Publish to a broadcast channel
 *   agent://machine/id        - Send direct to an agent
 *   project://machine/path    - Send to a project
 */

import { SignalDBClient } from '../../../client/signaldb';
import { ChannelClient } from '../../../channels/channel-client';
import { parseAddress } from '../../../protocol/address';
import {
  exitWithError,
  green,
  hasJsonFlag,
  jsonOutput,
  parseEnvConfig,
  yellow,
} from '../utils';

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute the send subcommand.
 *
 * @param args - CLI arguments after "send"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);

  // Filter out --json from args to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  // First positional arg is the address
  const addressUri = positional[0];
  if (!addressUri) {
    exitWithError('Usage: comms send <address> <message>');
  }

  // Determine message content: stdin (piped) or remaining args
  let content: string;
  if (!process.stdin.isTTY) {
    // Reading from pipe
    content = await Bun.stdin.text();
    content = content.trimEnd();
  } else {
    // Remaining positional args joined as message
    const messageParts = positional.slice(1);
    if (messageParts.length === 0) {
      exitWithError('No message provided. Pipe stdin or pass message as arguments.');
    }
    content = messageParts.join(' ');
  }

  if (!content) {
    exitWithError('Empty message. Provide a message body.');
  }

  const config = parseEnvConfig();

  // Parse the address to determine delivery method
  let address;
  try {
    address = parseAddress(addressUri);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    exitWithError(errMsg);
  }

  if (address.type === 'broadcast') {
    // Broadcast: resolve channel by name, then publish
    const channelClient = new ChannelClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
      agentId: config.agentId,
    });

    // Resolve channel name to channel ID
    const signalClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    let channel;
    try {
      channel = await signalClient.channels.getByName(address.channelName);
    } catch {
      exitWithError(`Channel not found: ${address.channelName}`);
    }

    const message = await channelClient.publish(channel.id, content, {
      messageType: 'chat',
    });

    if (jsonOutput(message, isJson)) {
      process.exit(0);
    }

    console.log(green(`Delivered to ${addressUri}`));
    process.exit(0);
  } else {
    // Agent or project address: send direct message via SignalDB
    const signalClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    // For direct messages, we need a channel. Use or create a direct channel.
    // For simplicity, send via messages API with target address info.
    const message = await signalClient.messages.send({
      channelId: '', // Direct messages may not need a channel
      senderId: config.agentId,
      targetType: address.type,
      targetAddress: addressUri,
      messageType: 'chat',
      content,
    });

    if (jsonOutput(message, isJson)) {
      process.exit(0);
    }

    const statusText = message.status === 'delivered'
      ? green(`Delivered to ${addressUri}`)
      : yellow(`Queued for ${addressUri}`);
    console.log(statusText);
    process.exit(0);
  }
}
