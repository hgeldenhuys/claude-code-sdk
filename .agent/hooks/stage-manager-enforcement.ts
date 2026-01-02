#!/usr/bin/env bun
/**
 * Stage Manager Enforcement Hook
 *
 * Enforces the Loom 2.0 Prime Directive: Stage Manager is a COORDINATOR, not an IMPLEMENTER.
 *
 * This hook intercepts Edit/Write operations and:
 * 1. WARNS when the main agent tries to edit implementation files
 * 2. Provides guidance on which actor should handle the work
 * 3. Tracks violations for metrics
 *
 * The hook checks for a marker to distinguish Stage Manager (main agent) from
 * spawned Actor agents. Actors are allowed to edit implementation files.
 *
 * @module hooks/stage-manager-enforcement
 */

import { HookManager } from 'claude-hooks-sdk';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const VIOLATIONS_LOG = '.agent/loom/metrics/stage-manager-violations.jsonl';
const LOOM_CONFIG = '.agent/loom/config.json';

// Ensure log directory exists
const violationsDir = path.dirname(VIOLATIONS_LOG);
if (!fs.existsSync(violationsDir)) {
  fs.mkdirSync(violationsDir, { recursive: true });
}

// ============================================================================
// Pattern Matching (mirrors stage-manager-guard.ts)
// ============================================================================

/**
 * Implementation file patterns that Stage Manager should NOT edit
 */
const PROHIBITED_PATTERNS = [
  // Source code files
  /^src\/.*\.(ts|tsx|js|jsx)$/,
  /^app\/.*\.(ts|tsx|js|jsx)$/,
  /^packages\/.*\.(ts|tsx|js|jsx)$/,
  /^apps\/.*\.(ts|tsx|js|jsx)$/,
  /^lib\/.*\.(ts|tsx|js|jsx)$/,

  // Styles
  /.*\.(css|scss|sass|less)$/,

  // Database
  /.*\.sql$/,
  /.*\/migrations\/.*/,

  // Build configs that require implementation knowledge
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^vite\.config\.(ts|js)$/,
  /^webpack\.config\.(ts|js)$/,
];

/**
 * Allowed paths for Stage Manager (domain memory & coordination)
 */
const ALLOWED_PATTERNS = [
  // Domain Memory
  /^\.agent\/loom\/.*/,
  /^\.agent\/weave\/.*/,
  /^\.agent\/hooks\/.*/,

  // Claude Code integration
  /^\.claude\/.*/,

  // Scripts & utilities
  /^scripts\/.*/,
  /^hooks\/.*/,

  // Documentation
  /.*\.md$/,
  /^docs\/.*/,

  // Test files (QA can handle, but planning tests is OK)
  /.*\.(test|spec)\.(ts|tsx|js|jsx)$/,
];

/**
 * Check if a file path matches prohibited patterns
 */
function isImplementationFile(filePath: string): boolean {
  // Normalize path
  const normalizedPath = filePath
    .replace(/^\/Users\/[^/]+\/[^/]+\/[^/]+\//, '') // Remove absolute path prefix
    .replace(/\\/g, '/');

  // Check if explicitly allowed first
  if (ALLOWED_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return false;
  }

  // Check if prohibited
  return PROHIBITED_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

/**
 * Get suggestion for which actor should handle this file
 */
function getSuggestion(filePath: string): string {
  const lowerPath = filePath.toLowerCase();

  if (lowerPath.includes('test') || lowerPath.includes('spec')) {
    return 'Delegate to **qa-engineer** actor for test modifications.';
  }

  if (
    lowerPath.includes('frontend') ||
    lowerPath.includes('component') ||
    lowerPath.includes('ui') ||
    lowerPath.endsWith('.tsx') ||
    lowerPath.endsWith('.css') ||
    lowerPath.endsWith('.scss')
  ) {
    return 'Delegate to **frontend-dev** actor for UI/frontend work.';
  }

  if (lowerPath.includes('infra') || lowerPath.includes('deploy') || lowerPath.includes('docker')) {
    return 'Delegate to **devops** actor for infrastructure work.';
  }

  if (lowerPath.endsWith('.sql') || lowerPath.includes('migration')) {
    return 'Delegate to **backend-dev** actor for database work.';
  }

  return 'Delegate to **backend-dev** or **frontend-dev** actor for implementation work.';
}

/**
 * Check if this session is an Actor (spawned) vs Stage Manager (main)
 *
 * Heuristic: Check if LOOM_ACTOR_TYPE env var is set (actors should set this)
 */
function isActorSession(): boolean {
  // Actors set this environment variable during boot-up
  return !!process.env.LOOM_ACTOR_TYPE;
}

/**
 * Check if enforcement is enabled in config
 */
function isEnforcementEnabled(): boolean {
  try {
    if (fs.existsSync(LOOM_CONFIG)) {
      const config = JSON.parse(fs.readFileSync(LOOM_CONFIG, 'utf-8'));
      return config.enforcement?.stageManagerGuard !== false;
    }
  } catch {
    // Default to enabled
  }
  return true;
}

/**
 * Log a violation for metrics
 */
function logViolation(sessionId: string, toolName: string, filePath: string, suggestion: string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    filePath,
    suggestion,
    enforced: isEnforcementEnabled(),
  };

  fs.appendFileSync(VIOLATIONS_LOG, JSON.stringify(entry) + '\n');
}

// ============================================================================
// Hook Manager
// ============================================================================

const manager = new HookManager({
  clientId: 'stage-manager-enforcement',
  logEvents: false,
});

/**
 * Pre-Tool Use: Check for Stage Manager violations
 *
 * This runs BEFORE the tool executes, allowing us to warn or block.
 */
manager.onPreToolUse(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Only check Edit and Write operations
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return { continue: true };
  }

  // If this is an Actor session, allow all edits
  if (isActorSession()) {
    return { continue: true };
  }

  // Get the file path from tool input
  const filePath = toolInput.file_path || toolInput.path || '';
  if (!filePath) {
    return { continue: true };
  }

  // Check if this is an implementation file
  if (!isImplementationFile(filePath)) {
    return { continue: true };
  }

  // This is a potential violation!
  const suggestion = getSuggestion(filePath);

  // Log the violation for metrics
  logViolation(sessionId, toolName, filePath, suggestion);

  // Output warning to stderr (visible to user and AI)
  console.error(`
[Stage Manager Violation]

You are attempting to edit an implementation file:
  ${filePath}

Stage Manager Rule: The orchestrating agent should COORDINATE, not IMPLEMENT.

${suggestion}

Use the Task tool to spawn an appropriate actor agent.

---
To disable this warning: Set enforcement.stageManagerGuard=false in .agent/loom/config.json
`);

  // For now, WARN but allow (set to false to block)
  const shouldBlock = false;

  if (shouldBlock && isEnforcementEnabled()) {
    return {
      continue: false,
      decision: 'block',
      reason: `Stage Manager should not edit implementation files. ${suggestion}`,
    };
  }

  return { continue: true };
});

manager.run();
