/**
 * Git Utility Functions
 *
 * Provides git repository state information for tracking changes
 * during Claude Code sessions.
 */

import { spawnSync } from 'node:child_process';

// ============================================================================
// Types
// ============================================================================

/**
 * Git repository state
 */
export interface GitState {
  /** Current commit hash (short form) */
  hash: string;
  /** Current branch name */
  branch: string;
  /** Whether there are uncommitted changes */
  isDirty: boolean;
  /** Whether the directory is a git repository */
  isRepo: boolean;
}

// ============================================================================
// Git State Functions
// ============================================================================

/**
 * Get the current git repository state
 *
 * @param cwd - Working directory to check (defaults to process.cwd())
 * @returns Git state information
 */
export function getGitState(cwd?: string): GitState {
  const workDir = cwd || process.cwd();

  // Default state for non-git directories
  const defaultState: GitState = {
    hash: '',
    branch: '',
    isDirty: false,
    isRepo: false,
  };

  try {
    // Check if this is a git repository
    const revParseResult = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (revParseResult.status !== 0 || revParseResult.stdout.trim() !== 'true') {
      return defaultState;
    }

    // Get current commit hash (short form)
    const hashResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    const hash = hashResult.status === 0 ? hashResult.stdout.trim() : '';

    // Get current branch name
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    const branch = branchResult.status === 0 ? branchResult.stdout.trim() : '';

    // Check for uncommitted changes (staged or unstaged)
    const statusResult = spawnSync('git', ['status', '--porcelain'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    const isDirty = statusResult.status === 0 && statusResult.stdout.trim().length > 0;

    return {
      hash,
      branch,
      isDirty,
      isRepo: true,
    };
  } catch {
    // Git command failed or timed out
    return defaultState;
  }
}

/**
 * Check if a directory is a git repository
 *
 * @param cwd - Working directory to check (defaults to process.cwd())
 * @returns True if the directory is inside a git repository
 */
export function isGitRepository(cwd?: string): boolean {
  const workDir = cwd || process.cwd();

  try {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    return result.status === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Get the git root directory
 *
 * @param cwd - Working directory to check (defaults to process.cwd())
 * @returns The root directory of the git repository, or null if not a repo
 */
export function getGitRoot(cwd?: string): string | null {
  const workDir = cwd || process.cwd();

  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (result.status === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}
