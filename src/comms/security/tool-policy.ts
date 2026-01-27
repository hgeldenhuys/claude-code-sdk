/**
 * Tool Allowlist Enforcement
 *
 * Per-agent tool restriction engine supporting wildcards and
 * a critical guard against --dangerously-skip-permissions.
 */

import type { ToolPolicy, ToolViolation } from './types';

// ============================================================================
// Tool Policy Engine
// ============================================================================

/**
 * Evaluates tool access policies per agent.
 *
 * Supports:
 * - Default policies applied to all agents
 * - Per-agent overrides
 * - Wildcard patterns (e.g. 'Bash*' matches 'Bash' and 'Bash:read-only')
 * - CRITICAL: blocks --dangerously-skip-permissions in all arguments
 *
 * @example
 * ```typescript
 * const engine = new ToolPolicyEngine(
 *   [
 *     { tool: 'Bash', allowed: true, reason: 'General shell access' },
 *     { tool: 'Write', allowed: false, reason: 'Read-only agent' },
 *   ],
 *   {
 *     'agent-admin': [
 *       { tool: 'Write', allowed: true, reason: 'Admin override' },
 *     ],
 *   },
 * );
 *
 * engine.isToolAllowed('agent-reader', 'Bash');   // true
 * engine.isToolAllowed('agent-reader', 'Write');   // false
 * engine.isToolAllowed('agent-admin', 'Write');    // true (override)
 * ```
 */
export class ToolPolicyEngine {
  private readonly defaultPolicies: ToolPolicy[];
  private readonly agentOverrides: Map<string, ToolPolicy[]>;

  /**
   * @param defaultPolicies - Default tool policies for all agents
   * @param agentOverrides - Per-agent policy overrides (keyed by agentId)
   */
  constructor(
    defaultPolicies: ToolPolicy[] = [],
    agentOverrides: Record<string, ToolPolicy[]> = {},
  ) {
    this.defaultPolicies = [...defaultPolicies];
    this.agentOverrides = new Map();

    for (const agentId of Object.keys(agentOverrides)) {
      const policies = agentOverrides[agentId];
      if (policies) {
        this.agentOverrides.set(agentId, [...policies]);
      }
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a tool is allowed for a specific agent.
   *
   * Resolution order:
   * 1. Check agent-specific overrides (if any match)
   * 2. Fall back to default policies
   * 3. If no policy matches, tool is allowed (open by default)
   *
   * @param agentId - The agent requesting tool access
   * @param toolName - The tool name to check
   * @returns true if the tool is allowed
   */
  isToolAllowed(agentId: string, toolName: string): boolean {
    // Check agent-specific overrides first
    const overrides = this.agentOverrides.get(agentId);
    if (overrides) {
      const match = this.findMatchingPolicy(overrides, toolName);
      if (match) {
        return match.allowed;
      }
    }

    // Fall back to default policies
    const defaultMatch = this.findMatchingPolicy(this.defaultPolicies, toolName);
    if (defaultMatch) {
      return defaultMatch.allowed;
    }

    // No policy = allowed by default
    return true;
  }

  /**
   * Get the effective tool policies for an agent.
   *
   * Merges default policies with agent-specific overrides.
   * Agent overrides take precedence over defaults for the same tool.
   *
   * @param agentId - The agent to get policies for
   * @returns Merged array of ToolPolicy entries
   */
  getAgentPolicy(agentId: string): ToolPolicy[] {
    const overrides = this.agentOverrides.get(agentId);
    if (!overrides) {
      return [...this.defaultPolicies];
    }

    // Start with defaults, then override with agent-specific policies
    const merged = new Map<string, ToolPolicy>();

    for (const policy of this.defaultPolicies) {
      merged.set(policy.tool, policy);
    }

    for (const policy of overrides) {
      merged.set(policy.tool, policy);
    }

    return Array.from(merged.values());
  }

  /**
   * CRITICAL: Validates that --dangerously-skip-permissions is never present
   * in a set of command arguments.
   *
   * This is the most important security check. The flag bypasses all
   * permission prompts in Claude Code and must NEVER be passed.
   *
   * @param args - Array of CLI arguments to validate
   * @returns true if the arguments are safe (no skip-permissions flag)
   */
  validateNoSkipPermissions(args: string[]): boolean {
    for (const arg of args) {
      const lower = arg.toLowerCase();
      if (
        lower === '--dangerously-skip-permissions' ||
        lower === '--dangerouslyskippermissions' ||
        lower.includes('dangerously-skip-permissions') ||
        lower.includes('dangerouslyskippermissions')
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create a SecurityViolation for a tool access denial.
   *
   * @param agentId - The agent that was denied
   * @param toolName - The tool that was blocked
   * @returns A ToolViolation object
   */
  createViolation(agentId: string, toolName: string): ToolViolation {
    const policy = this.findEffectivePolicy(agentId, toolName);
    return {
      type: 'tool',
      timestamp: new Date().toISOString(),
      agentId,
      message: `Tool "${toolName}" is not allowed for agent "${agentId}"`,
      toolName,
      reason: policy?.reason ?? 'No matching allow policy',
    };
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Find the first matching policy in a list for a given tool name.
   * Supports wildcard matching with trailing '*'.
   */
  private findMatchingPolicy(
    policies: ToolPolicy[],
    toolName: string,
  ): ToolPolicy | null {
    // Exact match first
    for (const policy of policies) {
      if (policy.tool === toolName) {
        return policy;
      }
    }

    // Wildcard match
    for (const policy of policies) {
      if (policy.tool.endsWith('*')) {
        const prefix = policy.tool.slice(0, -1);
        if (toolName.startsWith(prefix)) {
          return policy;
        }
      }
    }

    return null;
  }

  /**
   * Find the effective policy for an agent and tool (for error messages).
   */
  private findEffectivePolicy(
    agentId: string,
    toolName: string,
  ): ToolPolicy | null {
    const overrides = this.agentOverrides.get(agentId);
    if (overrides) {
      const match = this.findMatchingPolicy(overrides, toolName);
      if (match) return match;
    }
    return this.findMatchingPolicy(this.defaultPolicies, toolName);
  }
}
