/**
 * Paste Subcommand
 *
 * Manage ephemeral pastes: create, read, delete, list, shared.
 *
 * Usage:
 *   comms paste create <content> [--type text/plain] [--access read_once|ttl] [--ttl 3600] [--to agent-id] [--json]
 *   comms paste read <id> [--json]
 *   comms paste delete <id> [--json]
 *   comms paste list [--json]
 *   comms paste shared [--json]
 */

import { PasteClient } from '../../../pastes/paste-client';
import type { AccessType } from '../../../protocol/types';
import type { PasteView } from '../../../pastes/types';
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
  red,
  truncate,
  yellow,
} from '../utils';

// ============================================================================
// Formatting
// ============================================================================

function formatAccess(mode: string): string {
  switch (mode) {
    case 'read_once': return yellow('read_once');
    case 'ttl': return cyan('ttl');
    default: return dim(mode);
  }
}

function formatExpiry(paste: PasteView): string {
  if (paste.isExpired) return red('expired');
  if (paste.expiresAt) {
    const remaining = new Date(paste.expiresAt).getTime() - Date.now();
    if (remaining < 60_000) return yellow(`${Math.ceil(remaining / 1000)}s`);
    if (remaining < 3_600_000) return yellow(`${Math.ceil(remaining / 60_000)}m`);
    return green(`${Math.ceil(remaining / 3_600_000)}h`);
  }
  return dim('none');
}

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute the paste subcommand.
 *
 * @param args - CLI arguments after "paste"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);

  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    showHelp();
    return;
  }

  const config = parseEnvConfig();
  const client = new PasteClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
    agentId: config.agentId,
  });

  switch (sub) {
    case 'create':
      await createPaste(client, args.slice(1), isJson);
      break;
    case 'read':
      await readPaste(client, args.slice(1), isJson);
      break;
    case 'delete':
      await deletePaste(client, args.slice(1), isJson);
      break;
    case 'list':
      await listPastes(client, isJson);
      break;
    case 'shared':
      await listShared(client, isJson);
      break;
    default:
      exitWithError(`Unknown paste subcommand: ${sub}. Run 'comms paste help' for available commands.`);
  }
}

// ============================================================================
// Subcommands
// ============================================================================

async function createPaste(client: PasteClient, args: string[], isJson: boolean): Promise<void> {
  // Get positional content (first non-flag arg)
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--type' || arg === '-t' || arg === '--access' || arg === '-a' || arg === '--ttl' || arg === '--to') {
      i++; // skip value
    } else if (arg !== '--json') {
      positional.push(arg);
    }
  }

  const content = positional[0];
  if (!content) {
    exitWithError('Usage: comms paste create <content>');
  }

  const type = getFlagValue(args, '--type') ?? getFlagValue(args, '-t') ?? 'text/plain';
  const accessValue = getFlagValue(args, '--access') ?? getFlagValue(args, '-a') ?? 'ttl';
  const ttlStr = getFlagValue(args, '--ttl');
  const ttl = ttlStr ? parseInt(ttlStr, 10) : 3600;
  const to = getFlagValue(args, '--to');

  const validAccess = new Set(['read_once', 'ttl']);
  if (!validAccess.has(accessValue)) {
    exitWithError(`Invalid access mode: ${accessValue}. Valid: read_once, ttl`);
  }

  const paste = await client.create({
    content,
    contentType: type,
    accessMode: accessValue as AccessType,
    ttlSeconds: ttl,
    recipientId: to,
  });

  if (jsonOutput(paste, isJson)) return;

  console.log(green('Paste created successfully.'));
  console.log(`  ${bold('ID:')}      ${paste.id}`);
  console.log(`  ${bold('Type:')}    ${paste.contentType}`);
  console.log(`  ${bold('Access:')}  ${formatAccess(paste.accessMode)}`);
  if (paste.ttlSeconds) {
    console.log(`  ${bold('TTL:')}     ${paste.ttlSeconds}s`);
  }
  if (paste.recipientId) {
    console.log(`  ${bold('To:')}      ${cyan(paste.recipientId)}`);
  }
  console.log(`  ${bold('Expires:')} ${paste.expiresAt ? dim(paste.expiresAt) : dim('none')}`);
}

async function readPaste(client: PasteClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const pasteId = positional[0];
  if (!pasteId) {
    exitWithError('Usage: comms paste read <paste-id>');
  }

  const paste = await client.read(pasteId);

  if (jsonOutput(paste, isJson)) return;

  console.log(bold(`Paste: ${paste.id}\n`));
  console.log(`  ${bold('Creator:')}  ${cyan(paste.creatorId)}`);
  console.log(`  ${bold('Type:')}     ${paste.contentType}`);
  console.log(`  ${bold('Access:')}   ${formatAccess(paste.accessMode)}`);
  console.log(`  ${bold('Created:')}  ${gray(paste.createdAt)}`);
  if (paste.recipientId) {
    console.log(`  ${bold('To:')}       ${cyan(paste.recipientId)}`);
  }
  if (paste.expiresAt) {
    console.log(`  ${bold('Expires:')}  ${paste.isExpired ? red('EXPIRED') : dim(paste.expiresAt)}`);
  }
  if (paste.readBy.length > 0) {
    console.log(`  ${bold('Read by:')}  ${paste.readBy.join(', ')}`);
  }
  console.log('');
  console.log(dim('-'.repeat(60)));
  console.log('');
  console.log(paste.content);
  console.log('');
}

async function deletePaste(client: PasteClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const pasteId = positional[0];
  if (!pasteId) {
    exitWithError('Usage: comms paste delete <paste-id>');
  }

  await client.delete(pasteId);

  if (jsonOutput({ deleted: pasteId }, isJson)) return;

  console.log(green(`Paste deleted: ${pasteId}`));
}

async function listPastes(client: PasteClient, isJson: boolean): Promise<void> {
  const pastes = await client.getMyPastes();

  if (jsonOutput(pastes, isJson)) return;

  if (pastes.length === 0) {
    console.log(dim('No pastes found.'));
    return;
  }

  console.log(bold(`Your Pastes (${pastes.length})\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('Type'.padEnd(18))} ${bold('Access'.padEnd(12))} ${bold('Expiry'.padEnd(10))} ${bold('Content'.padEnd(30))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(95)));

  for (let i = 0; i < pastes.length; i++) {
    const paste = pastes[i]!;
    const id = truncate(paste.id, 8);
    const type = truncate(paste.contentType, 16);
    const access = formatAccess(paste.accessMode);
    const expiry = formatExpiry(paste);
    const content = truncate(paste.content.replace(/\n/g, ' '), 28);
    const date = formatTimestamp(paste.createdAt);

    console.log(
      `${gray(id.padEnd(10))} ${dim(type.padEnd(18))} ${access.padEnd(20)} ${expiry.padEnd(18)} ${content.padEnd(30)} ${dim(date)}`,
    );
  }
}

async function listShared(client: PasteClient, isJson: boolean): Promise<void> {
  const pastes = await client.getSharedWithMe();

  if (jsonOutput(pastes, isJson)) return;

  if (pastes.length === 0) {
    console.log(dim('No shared pastes found.'));
    return;
  }

  console.log(bold(`Shared With You (${pastes.length})\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('From'.padEnd(12))} ${bold('Type'.padEnd(18))} ${bold('Access'.padEnd(12))} ${bold('Expiry'.padEnd(10))} ${bold('Content'.padEnd(24))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(100)));

  for (let i = 0; i < pastes.length; i++) {
    const paste = pastes[i]!;
    const id = truncate(paste.id, 8);
    const from = truncate(paste.creatorId, 10);
    const type = truncate(paste.contentType, 16);
    const access = formatAccess(paste.accessMode);
    const expiry = formatExpiry(paste);
    const content = truncate(paste.content.replace(/\n/g, ' '), 22);
    const date = formatTimestamp(paste.createdAt);

    console.log(
      `${gray(id.padEnd(10))} ${cyan(from.padEnd(12))} ${dim(type.padEnd(18))} ${access.padEnd(20)} ${expiry.padEnd(18)} ${content.padEnd(24)} ${dim(date)}`,
    );
  }
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`${bold('comms paste')} - Ephemeral paste management

${bold('Usage:')}
  comms paste ${cyan('create')} <content>     Create a paste
  comms paste ${cyan('read')} <paste-id>      Read a paste
  comms paste ${cyan('delete')} <paste-id>    Delete a paste
  comms paste ${cyan('list')}                 List your pastes
  comms paste ${cyan('shared')}               List pastes shared with you

${bold('Create Options:')}
  --type, -t ${dim('<type>')}       Content type (default: text/plain)
  --access, -a ${dim('<mode>')}     Access mode: read_once | ttl (default: ttl)
  --ttl ${dim('<seconds>')}         TTL in seconds (default: 3600)
  --to ${dim('<agent-id>')}         Recipient agent ID

${bold('Output:')}
  --json                   Output as JSON`);
}
