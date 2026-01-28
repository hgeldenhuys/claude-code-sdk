#!/usr/bin/env bun
/**
 * Comms Memo CLI
 *
 * Manage agent memos: compose, list, read, reply, archive.
 *
 * Usage:
 *   comms-memo list [--category <cat>] [--priority <pri>] [--unread] [--json]
 *   comms-memo read <id>
 *   comms-memo compose <address> --subject <s> --body <b> [--category <c>] [--priority <p>] [--thread <id>]
 *   comms-memo reply <id> --body <b> [--subject <s>] [--category <c>] [--priority <p>]
 *   comms-memo archive <id>
 *
 * Environment:
 *   SIGNALDB_API_URL        SignalDB API base URL
 *   SIGNALDB_PROJECT_KEY    Project API key
 *   SIGNALDB_AGENT_ID       This agent's ID
 */

import { MemoClient } from '../src/comms/memos/memo-client';
import type { MemoCategory, MemoFilter, MemoPriority, MemoView } from '../src/comms/memos/types';

// ============================================================================
// Types
// ============================================================================

interface CLIOptions {
  subcommand: 'list' | 'read' | 'compose' | 'reply' | 'archive' | 'help';
  id?: string;
  address?: string;
  subject?: string;
  body?: string;
  category?: MemoCategory;
  priority?: MemoPriority;
  thread?: string;
  unread: boolean;
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
function magenta(text: string): string { return color(text, '35'); }

// ============================================================================
// Argument Parsing
// ============================================================================

const VALID_CATEGORIES = new Set(['knowledge', 'finding', 'question', 'action-item']);
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    subcommand: 'help',
    unread: false,
    json: false,
  };

  if (args.length === 0) {
    return options;
  }

  const sub = args[0];
  if (sub === 'list' || sub === 'read' || sub === 'compose' || sub === 'reply' || sub === 'archive') {
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
  if (sub === 'compose' && args.length > 1 && secondArg && !secondArg.startsWith('--')) {
    options.address = secondArg;
  } else if ((sub === 'read' || sub === 'reply' || sub === 'archive') && args.length > 1 && secondArg && !secondArg.startsWith('--')) {
    options.id = secondArg;
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];

    switch (arg) {
      case '--subject':
      case '-s':
        options.subject = next;
        i++;
        break;
      case '--body':
      case '-b':
        options.body = next;
        i++;
        break;
      case '--category':
      case '-c':
        if (next && VALID_CATEGORIES.has(next)) {
          options.category = next as MemoCategory;
        } else {
          console.error(yellow(`Invalid category: ${next}. Valid: knowledge, finding, question, action-item`));
        }
        i++;
        break;
      case '--priority':
      case '-p':
        if (next && VALID_PRIORITIES.has(next)) {
          options.priority = next as MemoPriority;
        } else {
          console.error(yellow(`Invalid priority: ${next}. Valid: P0, P1, P2, P3`));
        }
        i++;
        break;
      case '--thread':
        options.thread = next;
        i++;
        break;
      case '--unread':
        options.unread = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        // Skip positional args already handled
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

function createMemoClient(): MemoClient {
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

  return new MemoClient({
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

function formatPriority(pri: string): string {
  switch (pri) {
    case 'P0': return red(bold('P0'));
    case 'P1': return yellow('P1');
    case 'P2': return cyan('P2');
    case 'P3': return dim('P3');
    default: return dim(pri);
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'pending': return yellow('pending');
    case 'claimed': return cyan('claimed');
    case 'delivered': return green('delivered');
    case 'read': return dim('read');
    case 'expired': return gray('expired');
    default: return status;
  }
}

function formatCategory(cat: string): string {
  switch (cat) {
    case 'knowledge': return cyan('knowledge');
    case 'finding': return green('finding');
    case 'question': return magenta('question');
    case 'action-item': return yellow('action');
    default: return dim(cat);
  }
}

// ============================================================================
// Subcommands
// ============================================================================

async function listMemos(client: MemoClient, options: CLIOptions): Promise<void> {
  const filters: MemoFilter = {};
  if (options.category) filters.category = options.category;
  if (options.priority) filters.priority = options.priority;
  if (options.unread) filters.unreadOnly = true;

  const memos = await client.inbox(filters);

  if (options.json) {
    console.log(JSON.stringify(memos, null, 2));
    return;
  }

  if (memos.length === 0) {
    console.log(dim('No memos found.'));
    return;
  }

  const unreadCount = await client.getUnreadCount();
  console.log(bold(`Inbox (${memos.length} memos, ${unreadCount} unread)\n`));

  // Table header
  console.log(
    `${bold('ID'.padEnd(10))} ${bold('From'.padEnd(12))} ${bold('Subject'.padEnd(28))} ${bold('Cat'.padEnd(12))} ${bold('Pri'.padEnd(5))} ${bold('State'.padEnd(12))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(95)));

  for (const memo of memos) {
    const id = truncate(memo.id, 8);
    const from = truncate(memo.senderId, 10);
    const subject = truncate(memo.subject, 26);
    const cat = formatCategory(memo.category);
    const pri = formatPriority(memo.priority);
    const state = formatStatus(memo.status);
    const date = formatTimestamp(memo.createdAt);

    // Mark unread memos with a bullet
    const marker = (memo.status === 'pending' || memo.status === 'delivered') ? bold('*') : ' ';

    console.log(
      `${marker}${gray(id.padEnd(9))} ${cyan(from.padEnd(12))} ${subject.padEnd(28)} ${cat.padEnd(20)} ${pri.padEnd(13)} ${state.padEnd(20)} ${dim(date)}`,
    );
  }
}

async function readMemo(client: MemoClient, options: CLIOptions): Promise<void> {
  if (!options.id) {
    console.error(red('Usage: comms-memo read <memo-id>'));
    process.exit(1);
  }

  // Read the memo (auto-marks as read)
  let memo: MemoView;
  try {
    memo = await client.read(options.id);
  } catch {
    // If read fails (state transition), just fetch from inbox
    const inbox = await client.inbox();
    const found = inbox.find((m) => m.id === options.id || m.id.startsWith(options.id!));
    if (!found) {
      console.error(red(`Memo not found: ${options.id}`));
      process.exit(1);
    }
    memo = found;
  }

  if (options.json) {
    console.log(JSON.stringify(memo, null, 2));
    return;
  }

  console.log(bold(`Memo: ${memo.subject}\n`));
  console.log(`  ${bold('ID:')}        ${memo.id}`);
  console.log(`  ${bold('From:')}      ${cyan(memo.senderId)}`);
  console.log(`  ${bold('To:')}        ${memo.to}`);
  console.log(`  ${bold('Category:')}  ${formatCategory(memo.category)}`);
  console.log(`  ${bold('Priority:')}  ${formatPriority(memo.priority)}`);
  console.log(`  ${bold('Status:')}    ${formatStatus(memo.status)}`);
  console.log(`  ${bold('Date:')}      ${gray(memo.createdAt)}`);
  if (memo.threadId) {
    console.log(`  ${bold('Thread:')}    ${dim(memo.threadId)}`);
  }
  if (memo.expiresAt) {
    console.log(`  ${bold('Expires:')}   ${dim(memo.expiresAt)}`);
  }
  if (memo.claimedBy) {
    console.log(`  ${bold('Claimed:')}   ${dim(memo.claimedBy)}`);
  }
  console.log('');
  console.log(dim('-'.repeat(60)));
  console.log('');
  console.log(memo.body);
  console.log('');
}

async function composeMemo(client: MemoClient, options: CLIOptions): Promise<void> {
  if (!options.address) {
    console.error(red('Usage: comms-memo compose <address> --subject <s> --body <b>'));
    process.exit(1);
  }
  if (!options.subject) {
    console.error(red('Missing --subject flag'));
    process.exit(1);
  }
  if (!options.body) {
    console.error(red('Missing --body flag'));
    process.exit(1);
  }

  const memo = await client.compose({
    to: options.address,
    subject: options.subject,
    body: options.body,
    category: options.category,
    priority: options.priority,
    threadId: options.thread,
  });

  if (options.json) {
    console.log(JSON.stringify(memo, null, 2));
    return;
  }

  console.log(green(`Memo sent successfully.`));
  console.log(`  ${bold('ID:')}      ${memo.id}`);
  console.log(`  ${bold('To:')}      ${memo.to}`);
  console.log(`  ${bold('Subject:')} ${memo.subject}`);
}

async function replyToMemo(client: MemoClient, options: CLIOptions): Promise<void> {
  if (!options.id) {
    console.error(red('Usage: comms-memo reply <memo-id> --body <b>'));
    process.exit(1);
  }
  if (!options.body) {
    console.error(red('Missing --body flag'));
    process.exit(1);
  }

  const reply = await client.reply(options.id, {
    subject: options.subject ?? '(reply)',
    body: options.body,
    category: options.category,
    priority: options.priority,
  });

  if (options.json) {
    console.log(JSON.stringify(reply, null, 2));
    return;
  }

  console.log(green(`Reply sent successfully.`));
  console.log(`  ${bold('ID:')}      ${reply.id}`);
  console.log(`  ${bold('Thread:')}  ${reply.threadId ?? '(none)'}`);
  console.log(`  ${bold('Subject:')} ${reply.subject}`);
}

async function archiveMemo(client: MemoClient, options: CLIOptions): Promise<void> {
  if (!options.id) {
    console.error(red('Usage: comms-memo archive <memo-id>'));
    process.exit(1);
  }

  const memo = await client.archive(options.id);

  if (options.json) {
    console.log(JSON.stringify(memo, null, 2));
    return;
  }

  console.log(green(`Memo archived.`));
  console.log(`  ${bold('ID:')}      ${memo.id}`);
  console.log(`  ${bold('Status:')}  ${formatStatus(memo.status)}`);
}

function showHelp(): void {
  console.log(`${bold('comms-memo')} - Agent memo management

${bold('Usage:')}
  comms-memo ${cyan('list')}                          List inbox memos
  comms-memo ${cyan('read')} <id>                     Read a memo (auto-marks as read)
  comms-memo ${cyan('compose')} <address> --subject .. Compose and send a memo
  comms-memo ${cyan('reply')} <id> --body ..           Reply to a memo
  comms-memo ${cyan('archive')} <id>                   Archive (expire) a memo

${bold('Compose Options:')}
  --subject, -s ${dim('<text>')}     Subject line (required)
  --body, -b ${dim('<text>')}        Body content (required)
  --category, -c ${dim('<cat>')}     Category: knowledge, finding, question, action-item
  --priority, -p ${dim('<pri>')}     Priority: P0, P1, P2, P3
  --thread ${dim('<id>')}            Thread ID for threading

${bold('List Filters:')}
  --category, -c ${dim('<cat>')}     Filter by category
  --priority, -p ${dim('<pri>')}     Filter by priority
  --unread                 Show only unread memos
  --json                   Output as JSON

${bold('Environment:')}
  SIGNALDB_API_URL         SignalDB API base URL
  SIGNALDB_PROJECT_KEY     Project API key
  SIGNALDB_AGENT_ID        This agent's ID

${bold('Examples:')}
  comms-memo list --unread
  comms-memo list --category knowledge --priority P0
  comms-memo read abc12345
  comms-memo compose agent://mac-1/agent-2 -s "Build Results" -b "All tests passed" -p P1
  comms-memo reply abc12345 -b "Thanks for the update"
  comms-memo archive abc12345`);
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

  const client = createMemoClient();

  switch (options.subcommand) {
    case 'list':
      await listMemos(client, options);
      break;
    case 'read':
      await readMemo(client, options);
      break;
    case 'compose':
      await composeMemo(client, options);
      break;
    case 'reply':
      await replyToMemo(client, options);
      break;
    case 'archive':
      await archiveMemo(client, options);
      break;
  }
}

main().catch((error: Error) => {
  console.error(red(`Error: ${error.message}`));
  process.exit(1);
});
