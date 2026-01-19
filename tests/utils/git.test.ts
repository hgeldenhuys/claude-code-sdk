/**
 * Tests for Git Utility Functions
 *
 * Tests the getGitState function that provides git repository
 * state information (commit hash, branch, dirty status).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { getGitState, isGitRepository, getGitRoot } from '../../src/utils/git';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
  const tempDir = path.join(os.tmpdir(), `git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Initialize a git repository in a directory
 */
function initGitRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' });
  // Configure git user for commits
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf-8' });
}

/**
 * Create a commit in a git repository
 */
function createCommit(dir: string, message: string): string {
  const testFile = path.join(dir, 'test.txt');
  fs.writeFileSync(testFile, `${message}\n${Date.now()}`);
  spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['commit', '-m', message], { cwd: dir, encoding: 'utf-8' });

  // Get the commit hash
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf-8' });
  return result.stdout.trim();
}

/**
 * Create a branch and switch to it
 */
function createBranch(dir: string, branchName: string): void {
  spawnSync('git', ['checkout', '-b', branchName], { cwd: dir, encoding: 'utf-8' });
}

/**
 * Checkout a specific commit in detached HEAD state
 */
function checkoutDetached(dir: string, ref: string): void {
  spawnSync('git', ['checkout', ref], { cwd: dir, encoding: 'utf-8' });
}

/**
 * Add an unstaged change to the repo
 */
function addUnstagedChange(dir: string): void {
  const testFile = path.join(dir, 'unstaged.txt');
  fs.writeFileSync(testFile, `unstaged change ${Date.now()}`);
}

/**
 * Add a staged change to the repo
 */
function addStagedChange(dir: string): void {
  const testFile = path.join(dir, 'staged.txt');
  fs.writeFileSync(testFile, `staged change ${Date.now()}`);
  spawnSync('git', ['add', testFile], { cwd: dir, encoding: 'utf-8' });
}

// ============================================================================
// getGitState Tests
// ============================================================================

describe('getGitState', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('returns correct hash for current commit', () => {
    test('returns correct short hash after initial commit', () => {
      initGitRepo(testDir);
      const expectedHash = createCommit(testDir, 'Initial commit');

      const state = getGitState(testDir);

      expect(state.isRepo).toBe(true);
      expect(state.hash).toBe(expectedHash);
    });

    test('returns correct hash after multiple commits', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'First commit');
      createCommit(testDir, 'Second commit');
      const expectedHash = createCommit(testDir, 'Third commit');

      const state = getGitState(testDir);

      expect(state.hash).toBe(expectedHash);
    });

    test('hash is a short form (7-9 characters)', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Test commit');

      const state = getGitState(testDir);

      // Short hash is typically 7-9 characters
      expect(state.hash.length).toBeGreaterThanOrEqual(7);
      expect(state.hash.length).toBeLessThanOrEqual(12);
      // Hash should only contain hex characters
      expect(/^[0-9a-f]+$/.test(state.hash)).toBe(true);
    });
  });

  describe('returns correct branch name', () => {
    test('returns main or master for initial branch', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');

      const state = getGitState(testDir);

      // Git defaults to either 'main' or 'master' depending on config
      expect(['main', 'master']).toContain(state.branch);
    });

    test('returns correct name after creating and switching branch', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      createBranch(testDir, 'feature/test-branch');

      const state = getGitState(testDir);

      expect(state.branch).toBe('feature/test-branch');
    });

    test('returns correct branch name with special characters', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      createBranch(testDir, 'fix/bug-123_test');

      const state = getGitState(testDir);

      expect(state.branch).toBe('fix/bug-123_test');
    });
  });

  describe('detects dirty state (uncommitted changes)', () => {
    test('isDirty is false for clean repo', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(false);
    });

    test('isDirty is true with unstaged changes', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      addUnstagedChange(testDir);

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(true);
    });

    test('isDirty is true with staged changes', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      addStagedChange(testDir);

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(true);
    });

    test('isDirty is true with both staged and unstaged changes', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      addStagedChange(testDir);
      addUnstagedChange(testDir);

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(true);
    });

    test('isDirty is true with modified tracked file', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      // test.txt was created by createCommit, modify it
      const testFile = path.join(testDir, 'test.txt');
      fs.appendFileSync(testFile, '\nmodified content');

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(true);
    });

    test('isDirty is true with deleted file', () => {
      initGitRepo(testDir);
      createCommit(testDir, 'Initial commit');
      const testFile = path.join(testDir, 'test.txt');
      fs.unlinkSync(testFile);

      const state = getGitState(testDir);

      expect(state.isDirty).toBe(true);
    });
  });

  describe('returns isRepo: false for non-git directory', () => {
    test('returns isRepo: false for regular directory', () => {
      // testDir is created but not initialized as git repo

      const state = getGitState(testDir);

      expect(state.isRepo).toBe(false);
      expect(state.hash).toBe('');
      expect(state.branch).toBe('');
      expect(state.isDirty).toBe(false);
    });

    test('returns isRepo: false for non-existent directory', () => {
      const nonExistentDir = path.join(testDir, 'does-not-exist');

      const state = getGitState(nonExistentDir);

      expect(state.isRepo).toBe(false);
      expect(state.hash).toBe('');
      expect(state.branch).toBe('');
      expect(state.isDirty).toBe(false);
    });

    test('returns default state when git command fails', () => {
      // Simulate failure by using an invalid directory
      const state = getGitState('/invalid/path/that/does/not/exist');

      expect(state.isRepo).toBe(false);
      expect(state.hash).toBe('');
      expect(state.branch).toBe('');
      expect(state.isDirty).toBe(false);
    });
  });

  describe('handles detached HEAD state', () => {
    test('returns HEAD for branch name in detached HEAD state', () => {
      initGitRepo(testDir);
      const hash = createCommit(testDir, 'Initial commit');
      createCommit(testDir, 'Second commit');
      checkoutDetached(testDir, hash);

      const state = getGitState(testDir);

      expect(state.isRepo).toBe(true);
      expect(state.branch).toBe('HEAD');
      expect(state.hash).toBe(hash);
    });

    test('correctly reports dirty state in detached HEAD', () => {
      initGitRepo(testDir);
      const hash = createCommit(testDir, 'Initial commit');
      createCommit(testDir, 'Second commit');
      checkoutDetached(testDir, hash);
      addUnstagedChange(testDir);

      const state = getGitState(testDir);

      expect(state.isRepo).toBe(true);
      expect(state.branch).toBe('HEAD');
      expect(state.isDirty).toBe(true);
    });
  });

  describe('uses process.cwd() by default', () => {
    test('uses current working directory when no cwd specified', () => {
      // This test verifies the function works when called without a cwd argument
      // Since we're in a git repo (the SDK), it should return valid state
      const state = getGitState();

      // The SDK itself is a git repo
      expect(state.isRepo).toBe(true);
      expect(state.hash.length).toBeGreaterThan(0);
      expect(state.branch.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// isGitRepository Tests
// ============================================================================

describe('isGitRepository', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('returns true for git repository', () => {
    initGitRepo(testDir);

    const result = isGitRepository(testDir);

    expect(result).toBe(true);
  });

  test('returns false for non-git directory', () => {
    const result = isGitRepository(testDir);

    expect(result).toBe(false);
  });

  test('returns false for non-existent directory', () => {
    const result = isGitRepository('/non/existent/path');

    expect(result).toBe(false);
  });

  test('returns true for subdirectory of git repo', () => {
    initGitRepo(testDir);
    const subDir = path.join(testDir, 'subdir', 'nested');
    fs.mkdirSync(subDir, { recursive: true });

    const result = isGitRepository(subDir);

    expect(result).toBe(true);
  });
});

// ============================================================================
// getGitRoot Tests
// ============================================================================

describe('getGitRoot', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('returns root directory of git repo', () => {
    initGitRepo(testDir);

    const result = getGitRoot(testDir);

    // Use fs.realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
    expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(testDir));
  });

  test('returns root from subdirectory', () => {
    initGitRepo(testDir);
    const subDir = path.join(testDir, 'subdir', 'nested');
    fs.mkdirSync(subDir, { recursive: true });

    const result = getGitRoot(subDir);

    // Use fs.realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
    expect(result ? fs.realpathSync(result) : null).toBe(fs.realpathSync(testDir));
  });

  test('returns null for non-git directory', () => {
    const result = getGitRoot(testDir);

    expect(result).toBeNull();
  });

  test('returns null for non-existent directory', () => {
    const result = getGitRoot('/non/existent/path');

    expect(result).toBeNull();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Git Utilities - Edge Cases', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('handles repo with no commits', () => {
    initGitRepo(testDir);
    // Repo initialized but no commits made

    const state = getGitState(testDir);

    // Even with no commits, it's still a repo
    expect(state.isRepo).toBe(true);
    // Hash may be empty for repos with no commits
    // Branch might be main/master or empty depending on git version
  });

  test('handles directory names with spaces', () => {
    const dirWithSpaces = path.join(testDir, 'dir with spaces');
    fs.mkdirSync(dirWithSpaces, { recursive: true });
    initGitRepo(dirWithSpaces);
    createCommit(dirWithSpaces, 'Test commit');

    const state = getGitState(dirWithSpaces);

    expect(state.isRepo).toBe(true);
    expect(state.hash.length).toBeGreaterThan(0);
  });

  test('handles directory names with special characters', () => {
    const specialDir = path.join(testDir, 'dir-with_special.chars');
    fs.mkdirSync(specialDir, { recursive: true });
    initGitRepo(specialDir);
    createCommit(specialDir, 'Test commit');

    const state = getGitState(specialDir);

    expect(state.isRepo).toBe(true);
    expect(state.hash.length).toBeGreaterThan(0);
  });

  test('handles very long branch names', () => {
    initGitRepo(testDir);
    createCommit(testDir, 'Initial commit');
    const longBranchName = 'feature/' + 'a'.repeat(200);
    createBranch(testDir, longBranchName);

    const state = getGitState(testDir);

    expect(state.branch).toBe(longBranchName);
  });
});
