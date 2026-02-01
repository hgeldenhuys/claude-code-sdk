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
  | 'PostToolUseFailure'
  | 'Stop'
  | 'SubagentStop'
  | 'SubagentStart'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'Setup'
  | 'Notification'
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
  hook_event_name: 'SessionStart';
  /** How the session was initiated */
  source: SessionSource;
  /** Agent type if --agent was specified (2.1.2+) */
  agent_type?: string;
  /** Model being used (2.1.10+) */
  model?: string;
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
  hook_event_name: 'SessionEnd';
  /** Reason for session ending */
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'bypass_permissions_disabled' | 'other';
}

// SessionEnd has no output (session is already ending)

// ============================================================================
// PreToolUse
// ============================================================================

export interface PreToolUseInput extends BaseHookInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PreToolUseOutput {
  /** Whether to continue after hook execution (default: true) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
  /** Hide stdout from transcript mode (default: false) */
  suppressOutput?: boolean;
  /** Warning message shown to the user */
  systemMessage?: string;
  /** Hook-specific output for decision control */
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    /** Permission decision: allow bypasses permissions, deny blocks, ask prompts user */
    permissionDecision?: 'allow' | 'deny' | 'ask';
    /** Reason for the decision */
    permissionDecisionReason?: string;
    /** Modified tool input */
    updatedInput?: Record<string, unknown>;
    /** Additional context for Claude before tool executes */
    additionalContext?: string;
  };
  /** @deprecated Use hookSpecificOutput.permissionDecision instead */
  decision?: 'block' | 'approve';
  /** @deprecated Use hookSpecificOutput.permissionDecisionReason instead */
  reason?: string;
}

// ============================================================================
// PostToolUse
// ============================================================================

export interface PostToolUseInput extends BaseHookInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
}

export interface PostToolUseFailureInput extends BaseHookInput {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_error: string;
  tool_use_id: string;
}

export interface PostToolUseOutput {
  /** Whether to continue after hook execution (default: true) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
  /** Block to provide feedback to Claude */
  decision?: 'block';
  /** Reason shown to Claude when blocked */
  reason?: string;
  /** Hook-specific output */
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse';
    /** Additional context for Claude */
    additionalContext?: string;
  };
}

// ============================================================================
// Stop
// ============================================================================

export interface StopInput extends BaseHookInput {
  hook_event_name: 'Stop';
  /** Whether a Stop hook is already active (prevents infinite loops) */
  stop_hook_active: boolean;
}

export interface StopOutput {
  /** Block stopping to make Claude continue */
  decision?: 'block';
  /** Reason shown to Claude explaining why to continue (required when blocking) */
  reason?: string;
  /** Whether to continue after hook execution (takes precedence over decision) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
}

// ============================================================================
// SubagentStart / SubagentStop
// ============================================================================

export interface SubagentStartInput extends BaseHookInput {
  hook_event_name: 'SubagentStart';
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Agent type: built-in agents like "Bash", "Explore", "Plan", or custom agent names */
  agent_type: string;
}

export interface SubagentStopInput extends BaseHookInput {
  hook_event_name: 'SubagentStop';
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Path to the subagent's transcript file */
  agent_transcript_path: string;
  /** Whether a Stop hook is already active */
  stop_hook_active: boolean;
}

export interface SubagentStopOutput {
  /** Block stopping to make subagent continue */
  decision?: 'block';
  /** Reason shown to Claude subagent (required when blocking) */
  reason?: string;
  /** Whether to continue after hook execution (takes precedence over decision) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
}

// ============================================================================
// UserPromptSubmit
// ============================================================================

export interface UserPromptSubmitInput extends BaseHookInput {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
}

export interface UserPromptSubmitOutput {
  /** Block the prompt from being processed */
  decision?: 'block';
  /** Reason shown to user if blocked */
  reason?: string;
  /** Whether to continue processing (default: true) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
  /** Hook-specific output */
  hookSpecificOutput?: {
    hookEventName: 'UserPromptSubmit';
    /** Additional context added to conversation */
    additionalContext?: string;
  };
}

// ============================================================================
// PreCompact
// ============================================================================

export interface PreCompactInput extends BaseHookInput {
  hook_event_name: 'PreCompact';
  /** How compaction was triggered */
  trigger: 'manual' | 'auto';
  /** Custom instructions passed to /compact (only for manual trigger) */
  custom_instructions?: string;
}

export interface PreCompactOutput {
  /** Text to inject before compaction (will be preserved in summary) */
  result?: string;
}

// ============================================================================
// Setup (2.1.10+)
// ============================================================================

export type SetupTrigger = 'init' | 'maintenance';

export interface SetupInput extends BaseHookInput {
  hook_event_name: 'Setup';
  /** How Setup was triggered */
  trigger: SetupTrigger;
}

export interface SetupOutput {
  /** Hook-specific output */
  hookSpecificOutput?: {
    hookEventName: 'Setup';
    /** Additional context for Claude */
    additionalContext?: string;
  };
}

// ============================================================================
// Notification (2.1.17+)
// ============================================================================

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export interface NotificationInput extends BaseHookInput {
  hook_event_name: 'Notification';
  /** Notification message content */
  message: string;
  /** Type of notification */
  notification_type: NotificationType;
}

// Notification has no output that affects Claude

// ============================================================================
// PermissionRequest
// ============================================================================

export interface PermissionRequestInput extends BaseHookInput {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  /** Suggested "always allow" options the user would normally see (2.1.29+) */
  permission_suggestions?: Array<{ type: string; tool: string }>;
}

export interface PermissionRequestOutput {
  /** Hook-specific output for decision control */
  hookSpecificOutput?: {
    hookEventName: 'PermissionRequest';
    decision: {
      /** Allow or deny the permission request */
      behavior: 'allow' | 'deny';
      /** Modified tool input (only for allow) */
      updatedInput?: Record<string, unknown>;
      /** Message shown to model (only for deny) */
      message?: string;
      /** Whether to stop Claude (only for deny) */
      interrupt?: boolean;
    };
  };
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
  | PostToolUseFailureInput
  | StopInput
  | SubagentStartInput
  | SubagentStopInput
  | UserPromptSubmitInput
  | PreCompactInput
  | SetupInput
  | NotificationInput
  | PermissionRequestInput;

/**
 * Prompt-based hook configuration (2.1.17+)
 * Uses LLM to evaluate decisions instead of bash commands
 */
export interface PromptHookConfig {
  type: 'prompt';
  /** Prompt text sent to LLM. Use $ARGUMENTS for hook input JSON placeholder */
  prompt: string;
  /** Model to use for evaluation (defaults to a fast model) */
  model?: string;
  /** Timeout in seconds (default: 30) */
  timeout?: number;
  /** Custom spinner message displayed while hook runs */
  statusMessage?: string;
  /** If true, runs only once per session then removed (skills only) */
  once?: boolean;
}

/**
 * Command-based hook configuration
 */
export interface CommandHookConfig {
  type: 'command';
  /** Bash command to execute */
  command: string;
  /** Timeout in seconds (default: 600) */
  timeout?: number;
  /** If true, runs in the background without blocking */
  async?: boolean;
  /** Custom spinner message displayed while hook runs */
  statusMessage?: string;
  /** If true, runs only once per session then removed (skills only) */
  once?: boolean;
}

/**
 * Agent-based hook configuration (2.1.29+)
 * Spawns a subagent that can use tools to verify conditions before returning a decision
 */
export interface AgentHookConfig {
  type: 'agent';
  /** Prompt text sent to agent. Use $ARGUMENTS for hook input JSON placeholder */
  prompt: string;
  /** Model to use for evaluation */
  model?: string;
  /** Timeout in seconds (default: 60) */
  timeout?: number;
}

/**
 * Hook configuration (can be command, prompt, or agent-based)
 */
export type HookConfig = CommandHookConfig | PromptHookConfig | AgentHookConfig;

/**
 * Prompt-based hook response schema
 */
export interface PromptHookResponse {
  /** true allows the action, false prevents it */
  ok: boolean;
  /** Required when ok is false - explanation shown to Claude */
  reason?: string;
}
