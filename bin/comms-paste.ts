#!/usr/bin/env bun
/**
 * Comms Paste CLI
 *
 * Manage ephemeral pastes: create, read, delete, list, shared.
 *
 * Usage:
 *   comms-paste create <content>     Create a paste
 *   comms-paste read <paste-id>      Read a paste
 *   comms-paste delete <paste-id>    Delete a paste
 *   comms-paste list                 List your pastes
 *   comms-paste shared               List pastes shared with you
 *
 * Options:
 *   --type <type>        Content type (default: text/plain)
 *   --access <mode>      Access mode: read_once | ttl (default: ttl)
 *   --ttl <seconds>      TTL in seconds (default: 3600)
 *   --to <agent-id>      Recipient agent ID
 *   --json               JSON output
 *
 * Environment:
 *   SIGNALDB_API_URL        SignalDB API base URL
 *   SIGNALDB_PROJECT_KEY    Project API key
 *   SIGNALDB_AGENT_ID       This agent's ID
 */

import { PasteClient } from '../src/comms/pastes/paste-client';
import type { AccessType } from '../src/comms/protocol/types';
import type { PasteView } from '../src/comms/pastes/types';

// ============================================================================
// Types
// ============================================================================

interface CLIOptions {
  subcommand: 'create' | 'read' | 'delete' | 'list' | 'shared' | 'help';
  content?: string;
  id?: string;
  type: string;
  access: AccessType;
  ttl: number;
  to?: string;
  json: boolean;
}

// ============================================================================
// ANSI Color Helpers
// ============================================================================

const isTTY = process.stdout.isTTY ?? false;

function color(text: string, code: string): string {
  if (!isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function bold(text: string): string { return color(text, '1'); }
function dim(text: string): string { return color(text, '2'); }
function red(text: string): string { return color(text, '31'); }
function green(text: string): string { return color(text, '32'); }
function yellow(text: string): string { return color(text, '33'); }
function cyan(text: string): string { return color(text, '36'); }
function gray(text: string): string { return color(text, '90'); }

// ============================================================================
// Argument Parsing
// ============================================================================

const VALID_ACCESS_MODES = new Set(['read_once', 'ttl']);

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    subcommand: 'help',
    type: 'text/plain',
    access: 'ttl',
    ttl: 3600,
    json: false,
  };

  if (args.length === 0) {
    return options;
  }

  const sub = args[0];
  if (sub === 'create' || sub === 'read' || sub === 'delete' || sub === 'list' || sub === 'shared') {
    options.subcommand = sub;
  } else if (sub === 'help' || sub === '--help' || sub === '-h') {
    options.subcommand = 'help';
    return options;
  } else {
    console.error(red(`Unknown subcommand: ${sub}`));
    options.subcommand = 'help';
    return options;
  }

  // Parse positional arg after subcommand
  const secondArg = args[1];
  if (sub === 'create' && args.length > 1 && secondArg && !secondArg.startsWith('--')) {
    options.content = secondArg;
  } else if ((sub === 'read' || sub === 'delete') && args.length > 1 && secondArg && !secondArg.startsWith('--')) {
    options.id = secondArg;
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];

    switch (arg) {
      case '--type':
      case '-t':
        if (next) {
          options.type = next;
          i++;
        }
        break;
      case '--access':
      case '-a':
        if (next && VALID_ACCESS_MODES.has(next)) {
          options.access = next as AccessType;
        } else {
          console.error(yellow(`Invalid access mode: ${next}. Valid: read_once, ttl`));
        }
        i++;
        break;
      case '--ttl':
        if (next) {
          const parsed = parseInt(next, 10);
          if (!isNaN(parsed) && parsed > 0) {
            options.ttl = parsed;
          } else {
            console.error(yellow(`Invalid TTL: ${next}. Must be a positive integer.`));
          }
          i++;
        }
        break;
      case '--to':
        options.to = next;
        i++;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(yellow(`Unknown flag: ${arg}`));
        }
    }
  }

  return options;
}

// ============================================================================
// Client Setup
// ============================================================================

function createPasteClient(): PasteClient {
  const apiUrl = process.env.SIGNALDB_API_URL;
  const projectKey = process.env.SIGNALDB_PROJECT_KEY;
  const agentId = process.env.SIGNALDB_AGENT_ID;

  if (!apiUrl || !projectKey || !agentId) {
    console.error(red('Missing environment variables:'));
    if (!apiUrl) console.error(red('  SIGNALDB_API_URL'));
    if (!projectKey) console.error(red('  SIGNALDB_PROJECT_KEY'));
    if (!agentId) console.error(red('  SIGNALDB_AGENT_ID'));
    process.exit(1);
  }

  return new PasteClient({
    apiUrl,
    projectKey,
    agentId,
  });
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 2) + '..';
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) {
      return d.toTimeString().slice(0, 8);
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

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
// Subcommands
// ============================================================================

async function createPaste(client: PasteClient, options: CLIOptions): Promise<void> {
  if (!options.content) {
    console.error(red('Usage: comms-paste create <content>'));
    process.exit(1);
  }

  const paste = await client.create({
    content: options.content,
    contentType: options.type,
    accessMode: options.access,
    ttlSeconds: options.ttl,
    recipientId: options.to,
  });

  if (options.json) {
    console.log(JSON.stringify(paste, null, 2));
    return;
  }

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

async function readPaste(client: PasteClient, options: CLIOptions): Promise<void> {
  if (!options.id) {
    console.error(red('Usage: comms-paste read <paste-id>'));
    process.exit(1);
  }

  const paste = await client.read(options.id);

  if (options.json) {
    console.log(JSON.stringify(paste, null, 2));
    return;
  }

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

async function deletePaste(client: PasteClient, options: CLIOptions): Promise<void> {
  if (!options.id) {
    console.error(red('Usage: comms-paste delete <paste-id>'));
    process.exit(1);
  }

  await client.delete(options.id);

  if (options.json) {
    console.log(JSON.stringify({ deleted: options.id }));
    return;
  }

  console.log(green(`Paste deleted: ${options.id}`));
}

async function listPastes(client: PasteClient, options: CLIOptions): Promise<void> {
  const pastes = await client.getMyPastes();

  if (options.json) {
    console.log(JSON.stringify(pastes, null, 2));
    return;
  }

  if (pastes.length === 0) {
    console.log(dim('No pastes found.'));
    return;
  }

  console.log(bold(`Your Pastes (${pastes.length})\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('Type'.padEnd(18))} ${bold('Access'.padEnd(12))} ${bold('Expiry'.padEnd(10))} ${bold('Content'.padEnd(30))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(95)));

  for (const paste of pastes) {
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

async function listShared(client: PasteClient, options: CLIOptions): Promise<void> {
  const pastes = await client.getSharedWithMe();

  if (options.json) {
    console.log(JSON.stringify(pastes, null, 2));
    return;
  }

  if (pastes.length === 0) {
    console.log(dim('No shared pastes found.'));
    return;
  }

  console.log(bold(`Shared With You (${pastes.length})\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('From'.padEnd(12))} ${bold('Type'.padEnd(18))} ${bold('Access'.padEnd(12))} ${bold('Expiry'.padEnd(10))} ${bold('Content'.padEnd(24))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(100)));

  for (const paste of pastes) {
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

function showHelp(): void {
  console.log(`${bold('comms-paste')} - Ephemeral paste management

${bold('Usage:')}
  comms-paste ${cyan('create')} <content>     Create a paste
  comms-paste ${cyan('read')} <paste-id>      Read a paste
  comms-paste ${cyan('delete')} <paste-id>    Delete a paste
  comms-paste ${cyan('list')}                 List your pastes
  comms-paste ${cyan('shared')}               List pastes shared with you

${bold('Create Options:')}
  --type, -t ${dim('<type>')}       Content type (default: text/plain)
  --access, -a ${dim('<mode>')}     Access mode: read_once | ttl (default: ttl)
  --ttl ${dim('<seconds>')}         TTL in seconds (default: 3600)
  --to ${dim('<agent-id>')}         Recipient agent ID

${bold('Output:')}
  --json                   Output as JSON

${bold('Environment:')}
  SIGNALDB_API_URL         SignalDB API base URL
  SIGNALDB_PROJECT_KEY     Project API key
  SIGNALDB_AGENT_ID        This agent's ID

${bold('Examples:')}
  comms-paste create "Hello, world!"
  comms-paste create "{'key': 'value'}" --type application/json
  comms-paste create "Build log..." --access read_once --to agent-002
  comms-paste create "Results..." --ttl 300
  comms-paste read abc12345
  comms-paste delete abc12345
  comms-paste list --json
  comms-paste shared`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.subcommand === 'help') {
    showHelp();
    return;
  }

  const client = createPasteClient();

  switch (options.subcommand) {
    case 'create':
      await createPaste(client, options);
      break;
    case 'read':
      await readPaste(client, options);
      break;
    case 'delete':
      await deletePaste(client, options);
      break;
    case 'list':
      await listPastes(client, options);
      break;
    case 'shared':
      await listShared(client, options);
      break;
  }
}

main().catch((error: Error) => {
  console.error(red(`Error: ${error.message}`));
  process.exit(1);
});
