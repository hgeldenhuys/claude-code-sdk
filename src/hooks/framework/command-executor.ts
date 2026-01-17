/**
 * Command Executor
 *
 * Executes external command handlers with framework context
 * passed via environment variables.
 *
 * Environment variables set:
 * - CLAUDE_TURN_ID: Current turn ID (e.g., "abc123:3")
 * - CLAUDE_TURN_SEQUENCE: Current turn sequence number
 * - CLAUDE_SESSION_NAME: Human-friendly session name
 * - CLAUDE_SESSION_ID: Session ID
 * - CLAUDE_EVENT_TYPE: The hook event type
 * - CLAUDE_CWD: Current working directory
 */

import { spawn } from 'node:child_process';
import type { HookEvent } from '../types';
import type { HandlerResult, PipelineContext } from './types';

// ============================================================================
// Types
// ============================================================================

export interface FrameworkEnvVars {
  CLAUDE_TURN_ID?: string;
  CLAUDE_TURN_SEQUENCE?: string;
  CLAUDE_SESSION_NAME?: string;
  CLAUDE_SESSION_ID?: string;
  CLAUDE_EVENT_TYPE?: string;
  CLAUDE_CWD?: string;
}

export interface CommandExecutionOptions {
  /** Command to execute */
  command: string;
  /** Event data to pass via stdin */
  event: HookEvent;
  /** Pipeline context for extracting framework data */
  context: PipelineContext;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Working directory for command */
  cwd?: string;
}

export interface CommandExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** stdout output */
  stdout: string;
  /** stderr output */
  stderr: string;
  /** Exit code */
  exitCode: number | null;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error if execution failed */
  error?: string;
}

// ============================================================================
// Environment Variable Builder
// ============================================================================

/**
 * Build framework environment variables from pipeline context
 */
export function buildFrameworkEnv(context: PipelineContext): FrameworkEnvVars {
  const env: FrameworkEnvVars = {
    CLAUDE_EVENT_TYPE: context.eventType,
    CLAUDE_CWD: context.cwd,
  };

  // Add session ID
  if (context.sessionId) {
    env.CLAUDE_SESSION_ID = context.sessionId;
  }

  // Extract turn tracker data
  const turnTrackerResult = context.results.get('turn-tracker');
  if (turnTrackerResult?.data) {
    const data = turnTrackerResult.data as Record<string, unknown>;
    if (data.turnId) {
      env.CLAUDE_TURN_ID = String(data.turnId);
    }
    if (data.sequence !== undefined) {
      env.CLAUDE_TURN_SEQUENCE = String(data.sequence);
    }
  }

  // Extract session naming data
  const sessionNamingResult = context.results.get('session-naming');
  if (sessionNamingResult?.data) {
    const data = sessionNamingResult.data as Record<string, unknown>;
    if (data.sessionName) {
      env.CLAUDE_SESSION_NAME = String(data.sessionName);
    }
  }

  return env;
}

// ============================================================================
// Command Executor
// ============================================================================

/**
 * Execute an external command with framework context
 */
export async function executeCommand(
  options: CommandExecutionOptions
): Promise<CommandExecutionResult> {
  const { command, event, context, timeoutMs = 30000, cwd } = options;

  const startTime = Date.now();

  // Build environment with framework context
  const frameworkEnv = buildFrameworkEnv(context);
  const env = {
    ...process.env,
    ...frameworkEnv,
  };

  return new Promise((resolve) => {
    const [cmd, ...args] = parseCommand(command);

    const child = spawn(cmd, args, {
      env,
      cwd: cwd ?? context.cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Create new process group for clean termination
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Set timeout - kill entire process group for clean termination
    const timeout = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group (negative pid kills the group)
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Process may have already exited
          child.kill('SIGKILL');
        }
      }
    }, timeoutMs);

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Write event to stdin
    child.stdin?.write(JSON.stringify(event));
    child.stdin?.end();

    // Handle completion
    child.on('close', (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      if (timedOut) {
        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: code,
          durationMs,
          error: `Command timed out after ${timeoutMs}ms`,
        });
        return;
      }

      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        durationMs,
        error: code !== 0 ? `Command exited with code ${code}` : undefined,
      });
    });

    // Handle errors
    child.on('error', (err) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        durationMs,
        error: `Failed to execute command: ${err.message}`,
      });
    });
  });
}

/**
 * Parse a command string into command and arguments
 */
function parseCommand(command: string): string[] {
  // Simple parsing - split on spaces, respecting quotes
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of command) {
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/**
 * Parse command output into a handler result
 */
export function parseCommandOutput(output: string): HandlerResult {
  const trimmed = output.trim();

  // Empty output means approve/continue
  if (!trimmed) {
    return { success: true };
  }

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(trimmed);

    // Check for block decision
    if (parsed.decision === 'block') {
      return {
        decision: 'block',
        reason: parsed.reason ?? 'Blocked by external handler',
      };
    }

    // Check for context injection
    if (parsed.context) {
      return {
        context: parsed.context,
      };
    }

    // Return as data
    return {
      success: true,
      data: parsed,
    };
  } catch {
    // Not JSON - treat as context injection
    return {
      context: trimmed,
    };
  }
}

/**
 * Create a handler function that executes an external command
 */
export function createCommandHandler(
  command: string,
  timeoutMs?: number
): (context: PipelineContext) => Promise<HandlerResult> {
  return async (context: PipelineContext): Promise<HandlerResult> => {
    const result = await executeCommand({
      command,
      event: context.event,
      context,
      timeoutMs,
    });

    if (!result.success) {
      // Log error to stderr but don't block
      console.error(`[CommandHandler] ${result.error}`);
      if (result.stderr) {
        console.error(`[CommandHandler] stderr: ${result.stderr}`);
      }
      return { success: false, error: result.error };
    }

    return parseCommandOutput(result.stdout);
  };
}
