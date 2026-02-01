/**
 * Hook Integration Helpers
 *
 * Utilities for building Claude Code hooks with automatic
 * session tracking and standardized I/O handling.
 */

import { getSessionName, trackSession } from './sessions';
import type { TrackingResult } from './sessions';
import type {
  AgentHookConfig,
  BaseHookInput,
  HookEventName,
  NotificationInput,
  PermissionRequestInput,
  PermissionRequestOutput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PostToolUseOutput,
  PreCompactInput,
  PreCompactOutput,
  PreToolUseInput,
  PreToolUseOutput,
  PromptHookConfig,
  PromptHookResponse,
  SessionEndInput,
  SessionSource,
  SessionStartInput,
  SessionStartOutput,
  SetupInput,
  SetupOutput,
  StopInput,
  StopOutput,
  SubagentStartInput,
  SubagentStopInput,
  SubagentStopOutput,
  UserPromptSubmitInput,
  UserPromptSubmitOutput,
} from './types';

// ============================================================================
// I/O Utilities
// ============================================================================

/**
 * Read hook input from stdin (synchronous)
 */
export function readHookInput<T extends BaseHookInput>(): T {
  const chunks: Buffer[] = [];
  const fd = process.stdin.fd;
  const buf = Buffer.alloc(1024);
  // biome-ignore lint/style/useNodejsImportProtocol: dynamic require for sync stdin read
  const fs = require('fs');

  try {
    let bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
    while (bytesRead > 0) {
      chunks.push(buf.slice(0, bytesRead));
      bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
    }
  } catch {
    // End of input
  }

  const input = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(input) as T;
}

/**
 * Read hook input from stdin (async)
 */
export async function readHookInputAsync<T extends BaseHookInput>(): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as T);
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Write hook output to stdout
 */
export function writeHookOutput(output: object): void {
  process.stdout.write(JSON.stringify(output));
}

/**
 * Exit with success (no output needed)
 */
export function exitSuccess(): never {
  process.exit(0);
}

/**
 * Exit with error (non-zero code)
 */
export function exitError(code = 1): never {
  process.exit(code);
}

// ============================================================================
// Session Tracking Integration
// ============================================================================

/**
 * Options for session-aware hooks
 */
export interface SessionAwareOptions {
  /** Track session automatically */
  trackSession?: boolean;
  /** Force a specific session name */
  sessionName?: string;
}

/**
 * Context provided to hook handlers
 */
export interface HookContext<T extends BaseHookInput> {
  /** The parsed hook input */
  input: T;
  /** Session tracking result (if enabled) */
  session?: TrackingResult;
  /** Current session name (from tracking or lookup) */
  sessionName?: string;
}

/**
 * Create a session-aware SessionStart hook handler
 */
export function createSessionStartHook(
  handler: (ctx: HookContext<SessionStartInput>) => SessionStartOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<SessionStartInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: input.source,
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<SessionStartInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a session-aware PreToolUse hook handler
 */
export function createPreToolUseHook(
  handler: (ctx: HookContext<PreToolUseInput>) => PreToolUseOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<PreToolUseInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: 'startup', // PreToolUse doesn't have source
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<PreToolUseInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a session-aware PostToolUse hook handler
 */
export function createPostToolUseHook(
  handler: (ctx: HookContext<PostToolUseInput>) => PostToolUseOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<PostToolUseInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: 'startup',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<PostToolUseInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a session-aware Stop hook handler
 */
export function createStopHook(
  handler: (ctx: HookContext<StopInput>) => StopOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<StopInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: 'startup',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<StopInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a session-aware UserPromptSubmit hook handler
 */
export function createUserPromptSubmitHook(
  handler: (ctx: HookContext<UserPromptSubmitInput>) => UserPromptSubmitOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<UserPromptSubmitInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: 'startup',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<UserPromptSubmitInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a session-aware PreCompact hook handler
 */
export function createPreCompactHook(
  handler: (ctx: HookContext<PreCompactInput>) => PreCompactOutput | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<PreCompactInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source: 'compact',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<PreCompactInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

/**
 * Create a SessionEnd hook handler (no output)
 */
export function createSessionEndHook(
  handler: (ctx: HookContext<SessionEndInput>) => void,
  options: SessionAwareOptions = { trackSession: false }
): void {
  const input = readHookInput<SessionEndInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession) {
    session = trackSession(input.session_id, {
      source: 'startup',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<SessionEndInput> = { input, session, sessionName };
  handler(ctx);
}

/**
 * Create a PermissionRequest hook handler
 */
export function createPermissionRequestHook(
  handler: (ctx: HookContext<PermissionRequestInput>) => PermissionRequestOutput | undefined,
  options: SessionAwareOptions = { trackSession: false }
): void {
  const input = readHookInput<PermissionRequestInput>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  if (options.trackSession) {
    session = trackSession(input.session_id, {
      source: 'startup',
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<PermissionRequestInput> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output);
  }
}

// ============================================================================
// Common Hook Patterns
// ============================================================================

/**
 * Block a tool with a reason
 */
export function blockTool(reason: string): PreToolUseOutput {
  return { decision: 'block', reason };
}

/**
 * Approve a tool (explicit approval)
 */
export function approveTool(): PreToolUseOutput {
  return { decision: 'approve' };
}

/**
 * Modify tool input before execution
 */
export function modifyToolInput(newInput: Record<string, unknown>): PreToolUseOutput {
  return { tool_input: newInput };
}

/**
 * Inject context after tool execution
 */
export function injectContext(message: string): PostToolUseOutput | StopOutput {
  return { result: message };
}

/**
 * Block user prompt submission
 */
export function blockPrompt(reason: string): UserPromptSubmitOutput {
  return { decision: 'block', reason };
}

/**
 * Inject context with session start
 */
export function sessionStartContext(
  message: string,
  env?: Record<string, string>
): SessionStartOutput {
  return { result: message, env };
}

// ============================================================================
// Hook Config Builders (2.1.17+ prompt hooks, 2.1.29+ agent hooks)
// ============================================================================

/**
 * Build an agent-based hook configuration (2.1.29+).
 * Agent hooks spawn a subagent that can use tools to verify conditions.
 */
export function agentHook(
  prompt: string,
  opts?: { model?: string; timeout?: number }
): AgentHookConfig {
  return { type: 'agent', prompt, ...opts };
}

/**
 * Build a prompt-based hook configuration (2.1.17+).
 * Prompt hooks use an LLM to evaluate decisions without shell commands.
 */
export function promptHook(
  prompt: string,
  opts?: { model?: string; timeout?: number; statusMessage?: string; once?: boolean }
): PromptHookConfig {
  return { type: 'prompt', prompt, ...opts };
}

/**
 * Approve an action (prompt/agent hook response).
 * Returns `{ ok: true }` per the PromptHookResponse schema.
 */
export function approveAction(): PromptHookResponse {
  return { ok: true };
}

/**
 * Deny an action with a reason (prompt/agent hook response).
 * Returns `{ ok: false, reason }` per the PromptHookResponse schema.
 */
export function denyAction(reason: string): PromptHookResponse {
  return { ok: false, reason };
}

// ============================================================================
// Generic Hook Runner
// ============================================================================

type HookInputMap = {
  SessionStart: SessionStartInput;
  SessionEnd: SessionEndInput;
  PreToolUse: PreToolUseInput;
  PostToolUse: PostToolUseInput;
  PostToolUseFailure: PostToolUseFailureInput;
  Stop: StopInput;
  SubagentStart: SubagentStartInput;
  SubagentStop: SubagentStopInput;
  UserPromptSubmit: UserPromptSubmitInput;
  PreCompact: PreCompactInput;
  Setup: SetupInput;
  Notification: NotificationInput;
  PermissionRequest: PermissionRequestInput;
};

type HookOutputMap = {
  SessionStart: SessionStartOutput;
  SessionEnd: undefined;
  PreToolUse: PreToolUseOutput;
  PostToolUse: PostToolUseOutput;
  PostToolUseFailure: PostToolUseOutput;
  Stop: StopOutput;
  SubagentStart: undefined;
  SubagentStop: SubagentStopOutput;
  UserPromptSubmit: UserPromptSubmitOutput;
  PreCompact: PreCompactOutput;
  Setup: SetupOutput;
  Notification: undefined;
  PermissionRequest: PermissionRequestOutput;
};

/**
 * Run a generic hook with automatic session tracking
 */
export function runHook<E extends HookEventName>(
  _event: E,
  handler: (ctx: HookContext<HookInputMap[E]>) => HookOutputMap[E] | undefined,
  options: SessionAwareOptions = { trackSession: true }
): void {
  const input = readHookInput<HookInputMap[E]>();

  let session: TrackingResult | undefined;
  let sessionName: string | undefined;

  // Determine source based on input
  let source: SessionSource = 'startup';
  if ('source' in input) {
    source = (input as SessionStartInput).source;
  } else if ('trigger' in input && (input as PreCompactInput).trigger === 'auto') {
    source = 'compact';
  }

  if (options.trackSession !== false) {
    session = trackSession(input.session_id, {
      source,
      transcriptPath: input.transcript_path,
      cwd: input.cwd,
      name: options.sessionName,
    });
    sessionName = session.name;
  } else {
    sessionName = getSessionName(input.session_id);
  }

  const ctx: HookContext<HookInputMap[E]> = { input, session, sessionName };
  const output = handler(ctx);

  if (output) {
    writeHookOutput(output as Record<string, unknown>);
  }
}
