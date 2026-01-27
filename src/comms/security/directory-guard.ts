/**
 * Directory Restriction Guard
 *
 * Enforces --add-dir restrictions for agent sessions.
 * Ensures agents can only access files within their declared directories.
 */

import { resolve, normalize } from 'node:path';
import { realpathSync } from 'node:fs';
import type { DirectoryViolation } from './types';

// ============================================================================
// Directory Guard
// ============================================================================

/**
 * Guards file system access to allowed directories only.
 *
 * Validates paths against a set of allowed directories, handling:
 * - Symlink resolution (via realpath)
 * - Relative path resolution (to absolute)
 * - Path traversal attempts (../)
 *
 * @example
 * ```typescript
 * const guard = new DirectoryGuard(['/home/user/project']);
 *
 * guard.isPathAllowed('/home/user/project/src/index.ts'); // true
 * guard.isPathAllowed('/etc/passwd');                       // false
 * guard.isPathAllowed('/home/user/project/../../../etc/passwd'); // false
 *
 * const flags = guard.getAddDirFlags();
 * // ['--add-dir', '/home/user/project']
 * ```
 */
export class DirectoryGuard {
  private readonly allowedDirs: string[];
  private readonly resolvedDirs: string[];

  /**
   * @param allowedDirs - Absolute paths of allowed directories
   */
  constructor(allowedDirs: string[]) {
    this.allowedDirs = [...allowedDirs];
    this.resolvedDirs = [];

    for (const dir of allowedDirs) {
      const resolved = this.resolvePath(dir);
      this.resolvedDirs.push(resolved);
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a path is within any allowed directory.
   *
   * Resolves symlinks and normalizes the path before checking.
   *
   * @param path - Absolute or relative path to check
   * @returns true if the path is within an allowed directory
   */
  isPathAllowed(path: string): boolean {
    const resolved = this.resolvePath(path);

    for (const dir of this.resolvedDirs) {
      // Path must start with the allowed directory + separator
      // or be exactly the allowed directory
      if (resolved === dir || resolved.startsWith(dir + '/')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate a command string for path arguments that violate directory restrictions.
   *
   * Parses common command patterns to extract path arguments:
   * - Simple commands: `cat /etc/passwd`
   * - Quoted paths: `cat "/path/with spaces/file.txt"`
   * - Multiple arguments: `cp /src/a.txt /dst/b.txt`
   *
   * @param command - Shell command string to validate
   * @returns SecurityViolation if a restricted path is found, null if command is safe
   */
  validateCommand(command: string): DirectoryViolation | null {
    const paths = this.extractPaths(command);

    for (const path of paths) {
      if (!this.isPathAllowed(path)) {
        return {
          type: 'directory',
          timestamp: new Date().toISOString(),
          agentId: '',
          message: `Path "${path}" is outside allowed directories`,
          attemptedPath: path,
          allowedDirs: [...this.allowedDirs],
        };
      }
    }

    return null;
  }

  /**
   * Generate --add-dir CLI flags for Claude Code invocation.
   *
   * @returns Array of alternating ['--add-dir', path, '--add-dir', path, ...]
   */
  getAddDirFlags(): string[] {
    const flags: string[] = [];
    for (const dir of this.allowedDirs) {
      flags.push('--add-dir', dir);
    }
    return flags;
  }

  /**
   * Get the list of allowed directories.
   */
  getAllowedDirs(): string[] {
    return [...this.allowedDirs];
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Resolve a path to its absolute, normalized, symlink-resolved form.
   */
  private resolvePath(inputPath: string): string {
    // First normalize and resolve to absolute
    const absolute = resolve(normalize(inputPath));

    // Try to resolve symlinks; fall back to normalized path if target doesn't exist
    try {
      return realpathSync(absolute);
    } catch {
      return absolute;
    }
  }

  /**
   * Extract file system paths from a command string.
   *
   * Looks for arguments that look like absolute paths (starting with /).
   * Handles quoted strings and common shell patterns.
   */
  private extractPaths(command: string): string[] {
    const paths: string[] = [];

    // Match absolute paths: /foo/bar, "/foo/bar", '/foo/bar'
    // Also match paths with .. traversal that start with /
    const pathRegex = /(?:^|\s)("(\/[^"]*)")|(?:^|\s)('(\/[^']*)')|(?:^|\s)(\/\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = pathRegex.exec(command)) !== null) {
      // Group 2: double-quoted path, Group 4: single-quoted path, Group 5: unquoted path
      const path = match[2] ?? match[4] ?? match[5];
      if (path) {
        paths.push(path);
      }
    }

    return paths;
  }
}
