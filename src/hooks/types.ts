/**
 * Claude Code Hook Types
 *
 * Type definitions for all hook events and their inputs/outputs.
 */

// ============================================================================
// Common Types
// ============================================================================

export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'SubagentStart'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'PermissionRequest';

export type SessionSource = 'startup' | 'resume' | 'clear' | 'compact';

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';

export interface BaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: PermissionMode;
}

// ============================================================================
// SessionStart
// ============================================================================

export interface SessionStartInput extends BaseHookInput {
  /** How the session was initiated */
  source: SessionSource;
  /** Agent type if --agent was specified (2.1.2+) */
  agent_type?: string;
}

export interface SessionStartOutput {
  /** Text to inject into Claude's context */
  result?: string;
  /** Environment variables to set (written to CLAUDE_ENV_FILE) */
  env?: Record<string, string>;
}

// ============================================================================
// SessionEnd
// ============================================================================

export interface SessionEndInput extends BaseHookInput {
  /** Duration of the session in milliseconds */
  duration_ms?: number;
}

// SessionEnd has no output (session is already ending)

// ============================================================================
// PreToolUse
// ============================================================================

export interface PreToolUseInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseOutput {
  /** Block the tool from executing */
  decision?: 'block' | 'approve';
  /** Reason shown to Claude if blocked */
  reason?: string;
  /** Modified tool input (replaces original) */
  tool_input?: Record<string, unknown>;
}

// ============================================================================
// PostToolUse
// ============================================================================

export interface PostToolUseInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
  tool_error?: string;
}

export interface PostToolUseOutput {
  /** Text to inject into Claude's context after tool execution */
  result?: string;
}

// ============================================================================
// Stop
// ============================================================================

export interface StopInput extends BaseHookInput {
  /** Files that were edited during this response */
  edited_files?: string[];
  /** The stop reason */
  stop_reason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
}

export interface StopOutput {
  /** Text to inject into Claude's context */
  result?: string;
}

// ============================================================================
// SubagentStart / SubagentStop
// ============================================================================

export interface SubagentStartInput extends BaseHookInput {
  agent_name: string;
  agent_id: string;
  parent_session_id?: string;
}

export interface SubagentStopInput extends BaseHookInput {
  agent_name: string;
  agent_id: string;
  agent_transcript_path: string;
}

// ============================================================================
// UserPromptSubmit
// ============================================================================

export interface UserPromptSubmitInput extends BaseHookInput {
  prompt: string;
}

export interface UserPromptSubmitOutput {
  /** Block the prompt from being submitted */
  decision?: 'block' | 'approve';
  /** Reason shown to user if blocked */
  reason?: string;
  /** Text to inject into Claude's context */
  result?: string;
}

// ============================================================================
// PreCompact
// ============================================================================

export interface PreCompactInput extends BaseHookInput {
  /** How compaction was triggered */
  trigger: 'manual' | 'auto';
}

export interface PreCompactOutput {
  /** Text to inject before compaction (will be preserved in summary) */
  result?: string;
}

// ============================================================================
// PermissionRequest
// ============================================================================

export interface PermissionRequestInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  /** The permission rule suggested by Claude */
  suggested_rule?: string;
}

export interface PermissionRequestOutput {
  /** Approve or deny the permission request */
  decision?: 'approve' | 'deny';
  /** Updated permission rule to apply */
  updated_rule?: string;
}

// ============================================================================
// Hook Result Helpers
// ============================================================================

export interface HookResult {
  /** Continue normally (no blocking) */
  continue?: boolean;
  /** Block the action */
  block?: boolean;
  /** Message to show (for blocks or context injection) */
  message?: string;
  /** Modified input (for PreToolUse) */
  modifiedInput?: Record<string, unknown>;
}

// ============================================================================
// Environment Variables
// ============================================================================

/**
 * Environment variables available to hooks
 */
export interface HookEnvironment {
  /** Session ID (also in stdin) */
  SESSION_ID: string;
  /** Project directory */
  CLAUDE_PROJECT_DIR: string;
  /** Path to write env vars (SessionStart only) */
  CLAUDE_ENV_FILE?: string;
  /** Tool input parameters (PreToolUse, PostToolUse) */
  [key: `TOOL_INPUT_${string}`]: string;
}

// ============================================================================
// Generic Hook Event Type
// ============================================================================

/**
 * Union type for all hook event inputs
 */
export type HookEvent =
  | SessionStartInput
  | SessionEndInput
  | PreToolUseInput
  | PostToolUseInput
  | StopInput
  | SubagentStartInput
  | SubagentStopInput
  | UserPromptSubmitInput
  | PreCompactInput
  | PermissionRequestInput;
