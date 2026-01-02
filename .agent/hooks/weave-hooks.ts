#!/usr/bin/env bun
/**
 * Weave Hooks - Unified hook handler using claude-hooks-sdk
 *
 * Handles:
 * - SessionStart: Creates/resumes Weave agents (Shadow Advisor, Librarian)
 * - Stop: Extracts knowledge from edited files, disposes turn-scoped agents
 * - SessionEnd: Disposes session-scoped agents
 *
 * Agent Lifecycle Integration:
 * - Shadow Advisor: session-scoped (lives until SessionEnd)
 * - Librarian: session-scoped (lives until SessionEnd)
 * - Knowledge Extractor: turn-scoped (disposed at Stop)
 */

import {
  type HookInput,
  type StopHookInput,
  type SessionStartHookInput
} from 'claude-hooks-sdk';

import { AgentRegistry } from 'claude-agent-lifecycle';

// ============================================================================
// Types
// ============================================================================

interface HookResponse {
  continue: boolean;
  message?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEBUG = process.env.WEAVE_DEBUG === 'true' || process.argv.includes('--debug');
const STORAGE_PATH = process.env.WEAVE_STORAGE_PATH || '.agent/agents';

// ============================================================================
// Registry
// ============================================================================

let registry: AgentRegistry | null = null;

function getRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry({
      storagePath: STORAGE_PATH,
      debug: DEBUG,
    });
  }
  return registry;
}

// ============================================================================
// Utilities
// ============================================================================

function debug(...args: any[]): void {
  if (DEBUG) {
    console.error('[weave-hooks]', ...args);
  }
}

function respond(response: HookResponse): void {
  console.log(JSON.stringify(response));
}

// ============================================================================
// Hook Handlers
// ============================================================================

async function handleSessionStart(input: SessionStartHookInput): Promise<HookResponse> {
  const sessionId = input.session_id || 'unknown';
  debug(`Session started: ${sessionId.substring(0, 8)}...`);

  const reg = getRegistry();
  const agents: string[] = [];

  try {
    // Create/resume Shadow Advisor
    const { agent: shadow, isNew: shadowNew } = await reg.create({
      lifespan: 'session',
      name: 'shadow-advisor',
      sessionId,
      model: 'haiku',
      metadata: {
        role: 'knowledge-retrieval',
        dimensions: ['Q', 'E', 'O', 'M', 'C', 'A', 'T', 'Η', 'Π', 'Μ', 'Δ'],
      },
    });
    agents.push(`shadow-advisor(${shadowNew ? 'new' : 'resumed'})`);
    debug(`Shadow Advisor: ${shadowNew ? 'created' : 'resumed'} (turn ${shadow.turnCount})`);

    // Create/resume Librarian
    const { agent: librarian, isNew: librarianNew } = await reg.create({
      lifespan: 'session',
      name: 'librarian',
      sessionId,
      model: 'haiku',
      metadata: {
        role: 'file-discovery',
      },
    });
    agents.push(`librarian(${librarianNew ? 'new' : 'resumed'})`);
    debug(`Librarian: ${librarianNew ? 'created' : 'resumed'} (turn ${librarian.turnCount})`);

  } catch (error) {
    debug('Error creating agents:', error);
  }

  return {
    continue: true,
    message: `Weave session: ${sessionId.substring(0, 8)} [${agents.join(', ')}]`
  };
}

async function handleStop(input: StopHookInput): Promise<HookResponse> {
  const stopReason = input.stop_hook_reason || 'unknown';

  // Only process on end_turn (completed response)
  if (stopReason !== 'end_turn') {
    return { continue: true };
  }

  const reg = getRegistry();

  // Get tool results to find edited files
  const toolResults = input.tool_results || [];
  const editedFiles: string[] = [];

  for (const result of toolResults) {
    // Check for Edit/Write tool results
    if (result.tool_name === 'Edit' || result.tool_name === 'Write') {
      const filePath = result.tool_input?.file_path;
      if (filePath) {
        editedFiles.push(filePath);
      }
    }
  }

  if (editedFiles.length > 0) {
    debug(`Files edited this turn: ${editedFiles.length}`);
    // Note: Actual extraction happens via the Stop.ts hook that runs
    // the extraction script. This unified hook is for logging/tracking.
  }

  // Dispose turn-scoped agents
  try {
    const disposed = await reg.disposeByLifespan('turn');
    if (disposed > 0) {
      debug(`Disposed ${disposed} turn-scoped agents`);
    }
  } catch (error) {
    debug('Error disposing turn agents:', error);
  }

  return { continue: true };
}

async function handleSessionEnd(input: HookInput): Promise<HookResponse> {
  const sessionId = (input as any).session_id || 'unknown';
  debug(`Session ending: ${sessionId.substring(0, 8)}...`);

  const reg = getRegistry();

  // Dispose all session-scoped agents for this session
  try {
    const disposed = await reg.disposeByScope(sessionId);
    debug(`Disposed ${disposed} session-scoped agents`);
  } catch (error) {
    debug('Error disposing session agents:', error);
  }

  // This is also a good time to run final knowledge extraction
  // The actual sync could be triggered here if needed

  return {
    continue: true,
    message: `Weave session ended: ${sessionId.substring(0, 8)}`
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const stdinText = await Bun.stdin.text();

    if (!stdinText.trim()) {
      respond({ continue: true });
      return;
    }

    const input: HookInput = JSON.parse(stdinText);
    const eventName = input.hook_event_name || 'unknown';

    let response: HookResponse;

    switch (eventName) {
      case 'SessionStart':
        response = await handleSessionStart(input as SessionStartHookInput);
        break;
      case 'Stop':
        response = await handleStop(input as StopHookInput);
        break;
      case 'SessionEnd':
        response = await handleSessionEnd(input);
        break;
      default:
        response = { continue: true };
    }

    respond(response);

  } catch (error) {
    debug('Error:', error);
    respond({ continue: true });
  }
}

main();
