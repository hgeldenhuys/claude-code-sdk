/**
 * Channels Subcommand
 *
 * Manage communication channels: list, create, join, leave, archive.
 *
 * Usage:
 *   comms channels list [--json]
 *   comms channels create <name> [--type direct|project|broadcast] [--json]
 *   comms channels join <id> [--json]
 *   comms channels leave <id> [--json]
 *   comms channels archive <id> [--json]
 */

import { ChannelClient } from '../../../channels/channel-client';
import type { ChannelType } from '../../../protocol/types';
import {
  bold,
  cyan,
  dim,
  exitWithError,
  formatTimestamp,
  getFlagValue,
  gray,
  green,
  hasJsonFlag,
  jsonOutput,
  parseEnvConfig,
  truncate,
  yellow,
} from '../utils';

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute the channels subcommand.
 *
 * @param args - CLI arguments after "channels"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);

  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    showHelp();
    return;
  }

  const config = parseEnvConfig();
  const client = new ChannelClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
    agentId: config.agentId,
  });

  switch (sub) {
    case 'list':
      await listChannels(client, isJson);
      break;
    case 'create':
      await createChannel(client, args.slice(1), isJson);
      break;
    case 'join':
      await joinChannel(client, args.slice(1), isJson);
      break;
    case 'leave':
      await leaveChannel(client, args.slice(1), isJson);
      break;
    case 'archive':
      await archiveChannel(client, args.slice(1), isJson);
      break;
    default:
      exitWithError(`Unknown channels subcommand: ${sub}. Run 'comms channels help' for available commands.`);
  }
}

// ============================================================================
// Subcommands
// ============================================================================

async function listChannels(client: ChannelClient, isJson: boolean): Promise<void> {
  const channels = await client.listChannels();

  if (jsonOutput(channels, isJson)) return;

  if (channels.length === 0) {
    console.log(dim('No channels found.'));
    return;
  }

  console.log(bold(`Channels (${channels.length})\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('Name'.padEnd(20))} ${bold('Type'.padEnd(12))} ${bold('Members'.padEnd(10))} ${bold('Created')}`,
  );
  console.log(dim('-'.repeat(70)));

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i]!;
    const id = truncate(ch.id, 8);
    const name = truncate(ch.name, 18);
    const type = ch.type;
    const members = String(ch.members.length);
    const created = formatTimestamp(ch.createdAt);

    console.log(
      `${gray(id.padEnd(10))} ${cyan(name.padEnd(20))} ${dim(type.padEnd(12))} ${dim(members.padEnd(10))} ${dim(created)}`,
    );
  }
}

async function createChannel(client: ChannelClient, args: string[], isJson: boolean): Promise<void> {
  // Filter out flags to get positional name
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--type' || arg === '-t') {
      i++; // skip value
    } else if (arg !== '--json') {
      positional.push(arg);
    }
  }

  const name = positional[0];
  if (!name) {
    exitWithError('Usage: comms channels create <name> [--type direct|project|broadcast]');
  }

  const typeValue = getFlagValue(args, '--type') ?? getFlagValue(args, '-t') ?? 'broadcast';
  const validTypes = new Set(['direct', 'project', 'broadcast']);
  if (!validTypes.has(typeValue)) {
    exitWithError(`Invalid channel type: ${typeValue}. Valid: direct, project, broadcast`);
  }

  const channel = await client.createChannel(name, typeValue as ChannelType);

  if (jsonOutput(channel, isJson)) return;

  console.log(green('Channel created successfully.'));
  console.log(`  ${bold('ID:')}      ${channel.id}`);
  console.log(`  ${bold('Name:')}    ${cyan(channel.name)}`);
  console.log(`  ${bold('Type:')}    ${channel.type}`);
}

async function joinChannel(client: ChannelClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const channelId = positional[0];
  if (!channelId) {
    exitWithError('Usage: comms channels join <channel-id>');
  }

  const channel = await client.joinChannel(channelId);

  if (jsonOutput(channel, isJson)) return;

  console.log(green(`Joined channel ${cyan(channel.name)}`));
}

async function leaveChannel(client: ChannelClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const channelId = positional[0];
  if (!channelId) {
    exitWithError('Usage: comms channels leave <channel-id>');
  }

  const channel = await client.leaveChannel(channelId);

  if (jsonOutput(channel, isJson)) return;

  console.log(yellow(`Left channel ${cyan(channel.name)}`));
}

async function archiveChannel(client: ChannelClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const channelId = positional[0];
  if (!channelId) {
    exitWithError('Usage: comms channels archive <channel-id>');
  }

  await client.archiveChannel(channelId);

  if (jsonOutput({ archived: channelId }, isJson)) return;

  console.log(green(`Channel archived: ${channelId}`));
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`${bold('comms channels')} - Channel management

${bold('Usage:')}
  comms channels ${cyan('list')}                       List all channels
  comms channels ${cyan('create')} <name> [--type ..]  Create a channel
  comms channels ${cyan('join')} <id>                   Join a channel
  comms channels ${cyan('leave')} <id>                  Leave a channel
  comms channels ${cyan('archive')} <id>                Archive a channel

${bold('Create Options:')}
  --type, -t ${dim('<type>')}   Channel type: direct, project, broadcast (default: broadcast)

${bold('Output:')}
  --json               Output as JSON`);
}
