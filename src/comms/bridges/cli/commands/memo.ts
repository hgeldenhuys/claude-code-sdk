/**
 * Memo Subcommand
 *
 * Manage agent memos: list, compose, read, reply, archive.
 *
 * Usage:
 *   comms memo list [--unread] [--json]
 *   comms memo compose --to <addr> --subject <s> --body <b> [--priority P0-P3] [--category <cat>] [--json]
 *   comms memo read <id> [--json]
 *   comms memo reply <id> --body <b> [--json]
 *   comms memo archive <id> [--json]
 */

import { MemoClient } from '../../../memos/memo-client';
import type { MemoCategory, MemoFilter, MemoPriority, MemoView } from '../../../memos/types';
import {
  bold,
  cyan,
  dim,
  exitWithError,
  formatStatus,
  formatTimestamp,
  getFlagValue,
  gray,
  green,
  hasJsonFlag,
  jsonOutput,
  magenta,
  parseEnvConfig,
  red,
  truncate,
  yellow,
} from '../utils';

// ============================================================================
// Formatting
// ============================================================================

function formatPriority(pri: string): string {
  switch (pri) {
    case 'P0': return red(bold('P0'));
    case 'P1': return yellow('P1');
    case 'P2': return cyan('P2');
    case 'P3': return dim('P3');
    default: return dim(pri);
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
// Execute
// ============================================================================

const VALID_CATEGORIES = new Set(['knowledge', 'finding', 'question', 'action-item']);
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

/**
 * Execute the memo subcommand.
 *
 * @param args - CLI arguments after "memo"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);

  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    showHelp();
    return;
  }

  const config = parseEnvConfig();
  const client = new MemoClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
    agentId: config.agentId,
  });

  switch (sub) {
    case 'list':
      await listMemos(client, args.slice(1), isJson);
      break;
    case 'compose':
      await composeMemo(client, args.slice(1), isJson);
      break;
    case 'read':
      await readMemo(client, args.slice(1), isJson);
      break;
    case 'reply':
      await replyMemo(client, args.slice(1), isJson);
      break;
    case 'archive':
      await archiveMemo(client, args.slice(1), isJson);
      break;
    default:
      exitWithError(`Unknown memo subcommand: ${sub}. Run 'comms memo help' for available commands.`);
  }
}

// ============================================================================
// Subcommands
// ============================================================================

async function listMemos(client: MemoClient, args: string[], isJson: boolean): Promise<void> {
  const filters: MemoFilter = {};

  const category = getFlagValue(args, '--category') ?? getFlagValue(args, '-c');
  if (category && VALID_CATEGORIES.has(category)) {
    filters.category = category as MemoCategory;
  }

  const priority = getFlagValue(args, '--priority') ?? getFlagValue(args, '-p');
  if (priority && VALID_PRIORITIES.has(priority)) {
    filters.priority = priority as MemoPriority;
  }

  if (args.includes('--unread')) {
    filters.unreadOnly = true;
  }

  const memos = await client.inbox(filters);

  if (jsonOutput(memos, isJson)) return;

  if (memos.length === 0) {
    console.log(dim('No memos found.'));
    return;
  }

  const unreadCount = await client.getUnreadCount();
  console.log(bold(`Inbox (${memos.length} memos, ${unreadCount} unread)\n`));

  console.log(
    `${bold('ID'.padEnd(10))} ${bold('From'.padEnd(12))} ${bold('Subject'.padEnd(28))} ${bold('Cat'.padEnd(12))} ${bold('Pri'.padEnd(5))} ${bold('State'.padEnd(12))} ${bold('Date')}`,
  );
  console.log(dim('-'.repeat(95)));

  for (let i = 0; i < memos.length; i++) {
    const memo = memos[i]!;
    const id = truncate(memo.id, 8);
    const from = truncate(memo.senderId, 10);
    const subject = truncate(memo.subject, 26);
    const cat = formatCategory(memo.category);
    const pri = formatPriority(memo.priority);
    const state = formatStatus(memo.status);
    const date = formatTimestamp(memo.createdAt);
    const marker = (memo.status === 'pending' || memo.status === 'delivered') ? bold('*') : ' ';

    console.log(
      `${marker}${gray(id.padEnd(9))} ${cyan(from.padEnd(12))} ${subject.padEnd(28)} ${cat.padEnd(20)} ${pri.padEnd(13)} ${state.padEnd(20)} ${dim(date)}`,
    );
  }
}

async function composeMemo(client: MemoClient, args: string[], isJson: boolean): Promise<void> {
  const to = getFlagValue(args, '--to');
  const subject = getFlagValue(args, '--subject') ?? getFlagValue(args, '-s');
  const body = getFlagValue(args, '--body') ?? getFlagValue(args, '-b');
  const category = getFlagValue(args, '--category') ?? getFlagValue(args, '-c');
  const priority = getFlagValue(args, '--priority') ?? getFlagValue(args, '-p');

  if (!to) exitWithError('Missing --to flag. Usage: comms memo compose --to <address> --subject <s> --body <b>');
  if (!subject) exitWithError('Missing --subject flag');
  if (!body) exitWithError('Missing --body flag');

  const memo = await client.compose({
    to,
    subject,
    body,
    category: category && VALID_CATEGORIES.has(category) ? category as MemoCategory : undefined,
    priority: priority && VALID_PRIORITIES.has(priority) ? priority as MemoPriority : undefined,
  });

  if (jsonOutput(memo, isJson)) return;

  console.log(green('Memo sent successfully.'));
  console.log(`  ${bold('ID:')}      ${memo.id}`);
  console.log(`  ${bold('To:')}      ${memo.to}`);
  console.log(`  ${bold('Subject:')} ${memo.subject}`);
}

async function readMemo(client: MemoClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const memoId = positional[0];
  if (!memoId) {
    exitWithError('Usage: comms memo read <memo-id>');
  }

  let memo: MemoView;
  try {
    memo = await client.read(memoId);
  } catch {
    const inbox = await client.inbox();
    const found = inbox.find((m) => m.id === memoId || m.id.startsWith(memoId));
    if (!found) {
      exitWithError(`Memo not found: ${memoId}`);
    }
    memo = found;
  }

  if (jsonOutput(memo, isJson)) return;

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
  console.log('');
  console.log(dim('-'.repeat(60)));
  console.log('');
  console.log(memo.body);
  console.log('');
}

async function replyMemo(client: MemoClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--body' || arg === '-b' || arg === '--subject' || arg === '-s') {
      i++; // skip value
    } else if (arg !== '--json') {
      positional.push(arg);
    }
  }

  const memoId = positional[0];
  if (!memoId) {
    exitWithError('Usage: comms memo reply <memo-id> --body <body>');
  }

  const body = getFlagValue(args, '--body') ?? getFlagValue(args, '-b');
  if (!body) {
    exitWithError('Missing --body flag');
  }

  const subject = getFlagValue(args, '--subject') ?? getFlagValue(args, '-s');

  const reply = await client.reply(memoId, {
    subject: subject ?? '(reply)',
    body,
  });

  if (jsonOutput(reply, isJson)) return;

  console.log(green('Reply sent successfully.'));
  console.log(`  ${bold('ID:')}      ${reply.id}`);
  console.log(`  ${bold('Thread:')}  ${reply.threadId ?? '(none)'}`);
  console.log(`  ${bold('Subject:')} ${reply.subject}`);
}

async function archiveMemo(client: MemoClient, args: string[], isJson: boolean): Promise<void> {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--json') {
      positional.push(args[i]!);
    }
  }

  const memoId = positional[0];
  if (!memoId) {
    exitWithError('Usage: comms memo archive <memo-id>');
  }

  const memo = await client.archive(memoId);

  if (jsonOutput(memo, isJson)) return;

  console.log(green('Memo archived.'));
  console.log(`  ${bold('ID:')}      ${memo.id}`);
  console.log(`  ${bold('Status:')}  ${formatStatus(memo.status)}`);
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`${bold('comms memo')} - Agent memo management

${bold('Usage:')}
  comms memo ${cyan('list')}                              List inbox memos
  comms memo ${cyan('read')} <id>                         Read a memo
  comms memo ${cyan('compose')} --to <addr> --subject ..  Compose and send a memo
  comms memo ${cyan('reply')} <id> --body ..               Reply to a memo
  comms memo ${cyan('archive')} <id>                       Archive a memo

${bold('Compose Options:')}
  --to ${dim('<address>')}         Target address (required)
  --subject, -s ${dim('<text>')}   Subject line (required)
  --body, -b ${dim('<text>')}      Body content (required)
  --category, -c ${dim('<cat>')}   Category: knowledge, finding, question, action-item
  --priority, -p ${dim('<pri>')}   Priority: P0, P1, P2, P3

${bold('List Filters:')}
  --category, -c ${dim('<cat>')}   Filter by category
  --priority, -p ${dim('<pri>')}   Filter by priority
  --unread                 Show only unread memos
  --json                   Output as JSON`);
}
