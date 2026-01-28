/**
 * Listen Subcommand
 *
 * Subscribe to real-time SSE messages on a channel.
 *
 * Usage:
 *   comms listen [channel-name] [--json]
 *
 * If no channel name is provided, subscribes to the default project broadcast.
 */

import { SignalDBClient } from '../../../client/signaldb';
import { ChannelClient } from '../../../channels/channel-client';
import type { Message } from '../../../protocol/types';
import {
  bold,
  cyan,
  dim,
  exitWithError,
  gray,
  green,
  hasJsonFlag,
  parseEnvConfig,
  truncate,
} from '../utils';

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format a timestamp as HH:MM:SS.
 */
function formatTimeOnly(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toTimeString().slice(0, 8);
  } catch {
    return iso;
  }
}

/**
 * Format an incoming message for terminal display.
 */
function formatMessage(message: Message): string {
  const time = formatTimeOnly(message.createdAt);
  const sender = truncate(message.senderId, 12);
  return `${gray(`[${time}]`)} ${cyan(sender)} ${message.content}`;
}

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute the listen subcommand.
 *
 * @param args - CLI arguments after "listen"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);

  // Filter out --json to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const config = parseEnvConfig();

  const signalClient = new SignalDBClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
  });

  const channelClient = new ChannelClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
    agentId: config.agentId,
  });

  // Resolve channel
  let channelId: string;
  let channelName: string;

  const requestedChannel = positional[0];
  if (requestedChannel) {
    // Resolve by name
    let channel;
    try {
      channel = await signalClient.channels.getByName(requestedChannel);
    } catch {
      exitWithError(`Channel not found: ${requestedChannel}`);
    }
    channelId = channel.id;
    channelName = channel.name;
  } else {
    // Use default project broadcast channel
    const channels = await signalClient.channels.list({ type: 'broadcast' });
    if (channels.length === 0) {
      exitWithError('No broadcast channels available. Create one with: comms channels create <name> --type broadcast');
    }
    const defaultChannel = channels[0]!;
    channelId = defaultChannel.id;
    channelName = defaultChannel.name;
  }

  console.log(green(`Connected to channel ${bold(channelName)}, listening...`));
  console.log(dim('Press Ctrl+C to disconnect.\n'));

  // Subscribe to messages
  const subscription = channelClient.subscribe(channelId, (message: Message) => {
    if (isJson) {
      console.log(JSON.stringify(message));
    } else {
      console.log(formatMessage(message));
    }
  });

  // Handle graceful shutdown
  const cleanup = () => {
    console.log(dim('\nDisconnecting...'));
    subscription.unsubscribe();
    channelClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep the process alive
  await new Promise(() => {
    // This promise never resolves - process stays alive until SIGINT/SIGTERM
  });
}
