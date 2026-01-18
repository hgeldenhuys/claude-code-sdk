/**
 * Machine Identity Module
 *
 * Manages machine identification for multi-machine session namespacing.
 * Each machine gets a unique UUID stored at ~/.claude/machine-id.
 * Optional human-friendly aliases can be set for easier identification.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { GlobalSessionDatabase, MachineInfo } from './types';

// ============================================================================
// Constants
// ============================================================================

const MACHINE_ID_FILENAME = 'machine-id';
const MACHINE_ALIAS_FILENAME = 'machine-alias';

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the path to the .claude directory in the user's home
 */
function getClaudeDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.claude');
}

/**
 * Get the path to the machine ID file
 */
function getMachineIdPath(): string {
  return join(getClaudeDir(), MACHINE_ID_FILENAME);
}

/**
 * Get the path to the machine alias file
 */
function getMachineAliasPath(): string {
  return join(getClaudeDir(), MACHINE_ALIAS_FILENAME);
}

// ============================================================================
// UUID Generation
// ============================================================================

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (Node 14.17+, Bun)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Machine ID Management
// ============================================================================

// Cache machine ID at module level to avoid repeated file reads
let cachedMachineId: string | null = null;

/**
 * Reset the machine ID cache (for testing purposes)
 * This forces the next getMachineId() call to read from disk
 */
export function resetMachineIdCache(): void {
  cachedMachineId = null;
}

/**
 * Get the machine ID, creating one if it doesn't exist
 *
 * The machine ID is a UUID stored at ~/.claude/machine-id.
 * It persists across sessions and identifies this specific machine.
 *
 * Performance: This function caches the machine ID in memory after the first read.
 */
export function getMachineId(): string {
  // Return cached value if available
  if (cachedMachineId) {
    return cachedMachineId;
  }

  const machineIdPath = getMachineIdPath();

  // Try to read existing machine ID
  if (existsSync(machineIdPath)) {
    try {
      const id = readFileSync(machineIdPath, 'utf-8').trim();
      if (id && isValidUUID(id)) {
        cachedMachineId = id;
        return id;
      }
    } catch {
      // Fall through to generate new ID
    }
  }

  // Generate and store new machine ID
  const newId = generateUUID();
  const claudeDir = getClaudeDir();

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  writeFileSync(machineIdPath, `${newId}\n`);
  cachedMachineId = newId;
  return newId;
}

/**
 * Check if a string is a valid UUID v4
 */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// ============================================================================
// Machine Alias Management
// ============================================================================

/**
 * Get the machine alias if set
 */
export function getMachineAlias(): string | undefined {
  const aliasPath = getMachineAliasPath();

  if (existsSync(aliasPath)) {
    try {
      const alias = readFileSync(aliasPath, 'utf-8').trim();
      if (alias) {
        return alias;
      }
    } catch {
      // Fall through to return undefined
    }
  }

  return undefined;
}

/**
 * Set a human-friendly alias for this machine
 *
 * @param alias - The alias to set (e.g., "macbook-pro", "work-desktop")
 */
export function setMachineAlias(alias: string): void {
  const aliasPath = getMachineAliasPath();
  const claudeDir = getClaudeDir();

  // Normalize alias: lowercase, alphanumeric and hyphens only
  const normalizedAlias = alias
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalizedAlias) {
    throw new Error('Invalid alias: must contain at least one alphanumeric character');
  }

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  writeFileSync(aliasPath, `${normalizedAlias}\n`);
}

/**
 * Clear the machine alias
 */
export function clearMachineAlias(): void {
  const aliasPath = getMachineAliasPath();

  if (existsSync(aliasPath)) {
    const { unlinkSync } = require('node:fs');
    unlinkSync(aliasPath);
  }
}

// ============================================================================
// Machine Info
// ============================================================================

/**
 * Get full information about the current machine
 */
export function getMachineInfo(): MachineInfo {
  const id = getMachineId();
  const alias = getMachineAlias();
  const now = new Date().toISOString();

  return {
    id,
    alias,
    hostname: hostname(),
    registeredAt: now, // Will be updated by store when first registered
    lastSeen: now,
  };
}

/**
 * Get a display name for the current machine
 *
 * Returns alias if set, otherwise hostname, otherwise machine ID prefix
 */
export function getMachineDisplayName(): string {
  const alias = getMachineAlias();
  if (alias) {
    return alias;
  }

  const hn = hostname();
  if (hn) {
    return hn;
  }

  const id = getMachineId();
  return id.slice(0, 8);
}

// ============================================================================
// Machine Registry Queries
// ============================================================================

/**
 * List all registered machines from a database
 *
 * @param db - The global session database
 * @returns Array of machine info sorted by lastSeen (most recent first)
 */
export function listMachines(db: GlobalSessionDatabase): MachineInfo[] {
  const machines = Object.values(db.machines);

  // Sort by lastSeen, most recent first
  machines.sort((a, b) => {
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  return machines;
}

/**
 * Get machine info by ID from a database
 *
 * @param db - The global session database
 * @param machineId - The machine ID to look up
 * @returns MachineInfo or undefined if not found
 */
export function getMachineById(
  db: GlobalSessionDatabase,
  machineId: string
): MachineInfo | undefined {
  return db.machines[machineId];
}

/**
 * Check if the current machine is registered in a database
 *
 * @param db - The global session database
 * @returns true if current machine is registered
 */
export function isCurrentMachineRegistered(db: GlobalSessionDatabase): boolean {
  const currentId = getMachineId();
  return currentId in db.machines;
}

/**
 * Register or update the current machine in a database
 *
 * @param db - The global session database (will be mutated)
 * @returns The updated MachineInfo for the current machine
 */
export function registerCurrentMachine(db: GlobalSessionDatabase): MachineInfo {
  const currentId = getMachineId();
  const now = new Date().toISOString();

  const existing = db.machines[currentId];
  if (existing) {
    // Update lastSeen and alias
    existing.lastSeen = now;
    const alias = getMachineAlias();
    if (alias) {
      existing.alias = alias;
    }
    existing.hostname = hostname();
    return existing;
  }

  // Register new machine
  const info: MachineInfo = {
    id: currentId,
    alias: getMachineAlias(),
    hostname: hostname(),
    registeredAt: now,
    lastSeen: now,
  };

  db.machines[currentId] = info;
  db.currentMachineId = currentId;

  return info;
}
