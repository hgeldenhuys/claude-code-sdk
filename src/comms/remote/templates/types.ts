/**
 * Command Template Types
 *
 * Interfaces for parameterized command templates that generate
 * shell commands for common remote administration tasks.
 * Includes structured result types for per-step execution output.
 */

// ============================================================================
// Structured Result Types
// ============================================================================

/**
 * Result of a single execution step within a template command.
 */
export interface StepResult {
  /** Human-readable step name (e.g., 'git-pull', 'build', 'health-check') */
  stepName: string;
  /** Whether this step succeeded */
  status: 'success' | 'failure' | 'skipped';
  /** Standard output from the step */
  output: string;
  /** Standard error from the step */
  stderr: string;
  /** Process exit code (null if skipped) */
  exitCode: number | null;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if the step failed */
  error: string | null;
}

/**
 * Structured result from a template command execution.
 * Contains per-step results with timing and structured data fields.
 */
export interface StructuredCommandResult {
  /** Whether the overall command succeeded */
  success: boolean;
  /** Template name that produced this result */
  templateName: string;
  /** Total execution time in milliseconds across all steps */
  totalDurationMs: number;
  /** Ordered list of step results */
  steps: StepResult[];
  /** Template-specific structured data (e.g., health status, disk info) */
  data: Record<string, unknown>;
  /** Overall error message if the command failed */
  error: string | null;
  /** Timestamp when execution started */
  startedAt: string;
  /** Timestamp when execution completed */
  completedAt: string;
}

// ============================================================================
// Template Interface
// ============================================================================

/**
 * A reusable command template that generates shell commands from parameters.
 * Supports both legacy buildCommand() for backward compatibility and
 * executeCommand() for structured per-step execution.
 */
export interface CommandTemplate {
  /** Template name matching RemoteCommandType */
  name: string;
  /** Human-readable description */
  description: string;
  /** Build the shell command string from parameters (legacy) */
  buildCommand(params: Record<string, unknown>): string;
  /** Validate parameters, throw Error if invalid */
  validateParams(params: Record<string, unknown>): void;
  /** Execute the command with structured per-step results */
  executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult>;
}

// ============================================================================
// Shell Execution Helper
// ============================================================================

/**
 * Run a single shell command step with timing and output capture.
 * Uses Bun.spawn for process execution.
 *
 * @param stepName - Human-readable name for this step
 * @param command - Shell command string to execute
 * @param options - Optional cwd for working directory
 * @returns StepResult with output, timing, and status
 */
export async function runStep(
  stepName: string,
  command: string,
  options?: { cwd?: string; timeoutMs?: number }
): Promise<StepResult> {
  const startTime = Date.now();

  try {
    const proc = Bun.spawn(['sh', '-c', command], {
      cwd: options?.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let stdout = '';
    let stderrOut = '';

    // Read stdout
    if (proc.stdout) {
      const reader = proc.stdout.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.done) {
          done = true;
        } else {
          chunks.push(result.value);
        }
      }
      stdout = new TextDecoder().decode(Buffer.concat(chunks));
    }

    // Read stderr
    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.done) {
          done = true;
        } else {
          chunks.push(result.value);
        }
      }
      stderrOut = new TextDecoder().decode(Buffer.concat(chunks));
    }

    const exitCode = await proc.exited;
    const durationMs = Date.now() - startTime;

    return {
      stepName,
      status: exitCode === 0 ? 'success' : 'failure',
      output: stdout.trim(),
      stderr: stderrOut.trim(),
      exitCode,
      durationMs,
      error: exitCode !== 0 ? `Step "${stepName}" failed with exit code ${exitCode}` : null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      stepName,
      status: 'failure',
      output: '',
      stderr: errMsg,
      exitCode: null,
      durationMs,
      error: `Step "${stepName}" threw: ${errMsg}`,
    };
  }
}

/**
 * Characters that indicate potential shell injection.
 */
export const INJECTION_CHARS = /[;|&`]|\$\(|\$\{/;

// ============================================================================
// Parameter Types
// ============================================================================

/**
 * Parameters for deploy commands.
 */
export interface DeployParams {
  /** Application name (required) */
  app: string;
  /** Git branch to deploy (default: 'main') */
  branch?: string;
  /** Build command override */
  buildCmd?: string;
  /** Deployment directory (default: current directory) */
  deployDir?: string;
}

/**
 * Parameters for status check commands.
 */
export interface StatusParams {
  /** Application name (required) */
  app: string;
  /** Health check port (default: 3000) */
  port?: number;
  /** Log file path (default: '/var/log/app.log') */
  logPath?: string;
  /** Number of log lines to tail (default: 50) */
  logLines?: number;
}

/**
 * Parameters for config update commands.
 */
export interface ConfigParams {
  /** Environment variables to set (required, at least one) */
  envVars: Record<string, string>;
  /** Path to .env file (default: '.env') */
  envFile?: string;
  /** Application to restart after config change */
  app?: string;
  /** Whether to restart the app after setting env vars */
  restart?: boolean;
}

/**
 * Parameters for diagnostic commands.
 */
export interface DiagnosticParams {
  /** Diagnostic checks to run (required, at least one) */
  checks: ('disk' | 'memory' | 'processes' | 'storage')[];
  /** Paths for storage check */
  paths?: string[];
}

/**
 * Parameters for restart commands.
 */
export interface RestartParams {
  /** Application name (required) */
  app: string;
  /** Process manager type (required) */
  manager: 'pm2' | 'launchd';
}
