/**
 * Spawn Subcommand
 *
 * Spawn a fresh headless Claude session as a collaborator, register it,
 * and return output + sessionId for thread continuation.
 *
 * Usage:
 *   comms spawn <directory> "<task>" [--timeout 300] [--json]
 *
 * What it does:
 *   1. Validates the target directory exists
 *   2. Snapshots global-sessions.json before spawn
 *   3. Spawns `claude -p "<task>" --output-format json` in the directory
 *   4. Waits for the process to complete (default timeout: 300s)
 *   5. Extracts the new session ID by diffing global-sessions.json
 *   6. Registers the spawned session in SignalDB with metadata
 *   7. Outputs response with sessionId for continuation via `comms chat --continue`
 *
 * Examples:
 *   comms spawn /path/to/project "run the full test suite and report results"
 *   comms spawn . "investigate the memory leak" --timeout 600
 *   comms spawn ~/projects/api "show git status" --json
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { SignalDBClient } from '../../../client/signaldb';
import {
  bold,
  cyan,
  dim,
  exitWithError,
  getFlagValue,
  green,
  hasJsonFlag,
  parseEnvConfig,
  red,
  yellow,
} from '../utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for spawned process (seconds) */
const DEFAULT_TIMEOUT_S = 300;

/** Path to Claude's global sessions file */
const GLOBAL_SESSIONS_PATH = `${homedir()}/.claude/global-sessions.json`;

// ============================================================================
// Types
// ============================================================================

interface GlobalSession {
  sessionId: string;
  cwd?: string;
  lastActiveAt?: string;
  [key: string]: unknown;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// Execute
// ============================================================================

export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);
  const timeoutStr = getFlagValue(args, '--timeout');
  const timeoutS = timeoutStr ? parseInt(timeoutStr, 10) : DEFAULT_TIMEOUT_S;

  // Filter flags to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') continue;
    if (arg === '--timeout') { i++; continue; }
    positional.push(arg);
  }

  if (positional.length < 2) {
    exitWithError('Usage: comms spawn <directory> "<task>" [--timeout 300] [--json]');
  }

  const directory = resolve(positional[0]!);
  const task = positional.slice(1).join(' ');

  // Validate directory exists
  if (!existsSync(directory)) {
    exitWithError(`Directory does not exist: ${directory}`);
  }

  const config = parseEnvConfig();
  const client = new SignalDBClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
  });

  if (!isJson) {
    console.error(dim(`Spawning Claude in ${directory}...`));
    console.error(dim(`Task: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}`));
  }

  // Snapshot sessions before spawn
  const sessionsBefore = readGlobalSessions();

  // Spawn claude headless
  const result = await spawnClaude(directory, task, timeoutS);

  if (result.exitCode !== 0 && result.stderr) {
    if (!isJson) {
      console.error(yellow(`Claude exited with code ${result.exitCode}`));
      if (result.stderr) {
        console.error(dim(result.stderr.slice(0, 500)));
      }
    }
  }

  // Extract session ID by comparing before/after
  const sessionId = extractNewSessionId(sessionsBefore, directory);

  // Parse claude JSON output if possible
  let claudeContent = result.stdout.trim();
  let claudeSessionId = sessionId;

  // Try to parse as Claude JSON output format
  try {
    const parsed = JSON.parse(claudeContent);
    if (parsed.result) {
      claudeContent = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    }
    if (parsed.session_id) {
      claudeSessionId = parsed.session_id;
    }
  } catch {
    // Not JSON -- use raw stdout as content
  }

  // Register spawned agent in SignalDB
  let agentId: string | null = null;
  if (claudeSessionId) {
    try {
      const agent = await client.agents.register({
        machineId: config.agentId.split('-')[0] ?? 'unknown',
        sessionId: claudeSessionId,
        projectPath: directory,
        metadata: {
          spawned: true,
          spawnedBy: config.agentId,
          spawnedAt: new Date().toISOString(),
          task: task.slice(0, 200),
        },
      });
      agentId = agent.id;

      if (!isJson) {
        console.error(green(`Registered spawned agent: ${agent.id.slice(0, 8)}`));
      }
    } catch (err) {
      if (!isJson) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(yellow(`Warning: Could not register agent: ${msg}`));
      }
    }
  }

  // Output
  if (isJson) {
    console.log(JSON.stringify({
      status: result.exitCode === 0 ? 'ok' : 'error',
      exitCode: result.exitCode,
      sessionId: claudeSessionId ?? null,
      agentId: agentId ?? null,
      directory,
      content: claudeContent,
    }, null, 2));
  } else {
    console.log('');
    console.log(bold(cyan('Spawn Result')));
    console.log(claudeContent);
    if (claudeSessionId) {
      console.log('');
      console.log(dim(`Session: ${claudeSessionId}`));
      console.log(dim(`Continue: comms chat --continue ${claudeSessionId} "..."`));
    }
  }

  process.exit(result.exitCode === 0 ? 0 : 1);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read global-sessions.json and return all session entries.
 */
function readGlobalSessions(): GlobalSession[] {
  try {
    if (!existsSync(GLOBAL_SESSIONS_PATH)) return [];
    const raw = readFileSync(GLOBAL_SESSIONS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    // Some versions use { sessions: [...] } wrapper
    if (data.sessions && Array.isArray(data.sessions)) return data.sessions;
    return [];
  } catch {
    return [];
  }
}

/**
 * Extract the new session ID by comparing before/after snapshots of global-sessions.json.
 * Falls back to finding the most recent session matching the directory.
 */
function extractNewSessionId(
  before: GlobalSession[],
  directory: string,
): string | null {
  const after = readGlobalSessions();
  const beforeIds = new Set<string>();
  for (let i = 0; i < before.length; i++) {
    beforeIds.add(before[i]!.sessionId);
  }

  // Find sessions that are new (in after but not in before)
  const newSessions: GlobalSession[] = [];
  for (let i = 0; i < after.length; i++) {
    const session = after[i]!;
    if (!beforeIds.has(session.sessionId)) {
      newSessions.push(session);
    }
  }

  // Prefer session matching our directory
  for (let i = 0; i < newSessions.length; i++) {
    const s = newSessions[i]!;
    if (s.cwd === directory) return s.sessionId;
  }

  // Take the most recent new session
  if (newSessions.length > 0) {
    // Sort by lastActiveAt descending
    newSessions.sort((a, b) => {
      const timeA = a.lastActiveAt ?? '';
      const timeB = b.lastActiveAt ?? '';
      return timeB.localeCompare(timeA);
    });
    return newSessions[0]!.sessionId;
  }

  // Fallback: find the most recent session matching directory from the full list
  const matching: GlobalSession[] = [];
  for (let i = 0; i < after.length; i++) {
    const s = after[i]!;
    if (s.cwd === directory) {
      matching.push(s);
    }
  }

  if (matching.length > 0) {
    matching.sort((a, b) => {
      const timeA = a.lastActiveAt ?? '';
      const timeB = b.lastActiveAt ?? '';
      return timeB.localeCompare(timeA);
    });
    return matching[0]!.sessionId;
  }

  return null;
}

/**
 * Spawn claude in headless mode and wait for completion.
 */
async function spawnClaude(
  directory: string,
  task: string,
  timeoutS: number,
): Promise<SpawnResult> {
  const proc = Bun.spawn(
    ['claude', '-p', task, '--output-format', 'json'],
    {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    },
  );

  // Set up timeout
  const timeoutMs = timeoutS * 1000;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    // Read output streams
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    clearTimeout(timer);

    if (timedOut) {
      return {
        stdout: stdout || '',
        stderr: `Process timed out after ${timeoutS}s`,
        exitCode: 124, // Standard timeout exit code
      };
    }

    return { stdout, stderr, exitCode };
  } catch (err) {
    clearTimeout(timer);
    return {
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}
