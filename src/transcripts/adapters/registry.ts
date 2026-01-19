/**
 * Adapter Registry
 *
 * Singleton registry for managing transcript adapters.
 * Provides registration, lookup, and lifecycle management.
 */

import type { Database } from 'bun:sqlite';
import type {
  AdapterRegistrationOptions,
  RegisteredAdapter,
  TranscriptAdapter,
} from './types';

/**
 * Default registration options
 */
const DEFAULT_OPTIONS: Required<AdapterRegistrationOptions> = {
  initSchema: true,
  enabled: true,
};

/**
 * AdapterRegistry - Singleton for managing transcript adapters
 *
 * Usage:
 * ```ts
 * const registry = AdapterRegistry.getInstance();
 * registry.register(myAdapter);
 * const adapter = registry.get('my-adapter');
 * ```
 */
export class AdapterRegistry {
  private static instance: AdapterRegistry | null = null;

  private adapters: Map<string, RegisteredAdapter> = new Map();
  private db: Database | null = null;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    if (AdapterRegistry.instance) {
      AdapterRegistry.instance.clear();
      AdapterRegistry.instance = null;
    }
  }

  /**
   * Set the database connection for schema initialization
   */
  setDatabase(db: Database): void {
    this.db = db;
  }

  /**
   * Get the database connection
   */
  getDatabase(): Database | null {
    return this.db;
  }

  /**
   * Register an adapter
   *
   * @param adapter - The adapter to register
   * @param options - Registration options
   * @throws Error if adapter with same name is already registered
   */
  register(
    adapter: TranscriptAdapter,
    options: AdapterRegistrationOptions = {}
  ): void {
    const name = adapter.name;

    if (this.adapters.has(name)) {
      throw new Error(`Adapter '${name}' is already registered`);
    }

    const mergedOptions: Required<AdapterRegistrationOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Initialize schema if requested and database is available
    if (mergedOptions.initSchema && this.db && adapter.initSchema) {
      adapter.initSchema(this.db);
    }

    // Call onRegister hook
    if (adapter.onRegister) {
      adapter.onRegister();
    }

    this.adapters.set(name, {
      adapter,
      options: mergedOptions,
      registeredAt: new Date(),
      enabled: mergedOptions.enabled,
    });
  }

  /**
   * Unregister an adapter
   *
   * @param name - Name of the adapter to unregister
   * @returns true if adapter was unregistered, false if not found
   */
  unregister(name: string): boolean {
    const registered = this.adapters.get(name);
    if (!registered) {
      return false;
    }

    // Call onUnregister hook
    if (registered.adapter.onUnregister) {
      registered.adapter.onUnregister();
    }

    this.adapters.delete(name);
    return true;
  }

  /**
   * Get an adapter by name
   *
   * @param name - Name of the adapter
   * @returns The adapter or undefined if not found
   */
  get(name: string): TranscriptAdapter | undefined {
    return this.adapters.get(name)?.adapter;
  }

  /**
   * Get registered adapter info by name
   *
   * @param name - Name of the adapter
   * @returns The registered adapter info or undefined
   */
  getRegistered(name: string): RegisteredAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Check if an adapter is registered
   *
   * @param name - Name of the adapter
   * @returns true if registered
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * List all registered adapters
   *
   * @param enabledOnly - If true, only return enabled adapters
   * @returns Array of adapter names
   */
  list(enabledOnly = false): string[] {
    const names: string[] = [];
    for (const [name, registered] of this.adapters) {
      if (!enabledOnly || registered.enabled) {
        names.push(name);
      }
    }
    return names;
  }

  /**
   * Get all registered adapters
   *
   * @param enabledOnly - If true, only return enabled adapters
   * @returns Array of adapters
   */
  getAll(enabledOnly = false): TranscriptAdapter[] {
    const adapters: TranscriptAdapter[] = [];
    for (const registered of this.adapters.values()) {
      if (!enabledOnly || registered.enabled) {
        adapters.push(registered.adapter);
      }
    }
    return adapters;
  }

  /**
   * Enable an adapter
   *
   * @param name - Name of the adapter
   * @returns true if adapter was enabled, false if not found
   */
  enable(name: string): boolean {
    const registered = this.adapters.get(name);
    if (!registered) {
      return false;
    }
    registered.enabled = true;
    return true;
  }

  /**
   * Disable an adapter
   *
   * @param name - Name of the adapter
   * @returns true if adapter was disabled, false if not found
   */
  disable(name: string): boolean {
    const registered = this.adapters.get(name);
    if (!registered) {
      return false;
    }
    registered.enabled = false;
    return true;
  }

  /**
   * Check if an adapter is enabled
   *
   * @param name - Name of the adapter
   * @returns true if enabled, false if disabled or not found
   */
  isEnabled(name: string): boolean {
    return this.adapters.get(name)?.enabled ?? false;
  }

  /**
   * Get adapter count
   *
   * @param enabledOnly - If true, only count enabled adapters
   * @returns Number of adapters
   */
  count(enabledOnly = false): number {
    if (!enabledOnly) {
      return this.adapters.size;
    }
    let count = 0;
    for (const registered of this.adapters.values()) {
      if (registered.enabled) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all registered adapters
   */
  clear(): void {
    // Call onUnregister for all adapters
    for (const registered of this.adapters.values()) {
      if (registered.adapter.onUnregister) {
        registered.adapter.onUnregister();
      }
    }
    this.adapters.clear();
  }

  /**
   * Get adapters that handle a specific file extension
   *
   * @param extension - File extension (e.g., '.jsonl')
   * @param enabledOnly - If true, only return enabled adapters
   * @returns Array of adapters
   */
  getByExtension(extension: string, enabledOnly = false): TranscriptAdapter[] {
    const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    const adapters: TranscriptAdapter[] = [];

    for (const registered of this.adapters.values()) {
      if (!enabledOnly || registered.enabled) {
        const adapterExts = registered.adapter.fileExtensions.map((e) =>
          e.startsWith('.') ? e : `.${e}`
        );
        if (adapterExts.includes(normalizedExt)) {
          adapters.push(registered.adapter);
        }
      }
    }

    return adapters;
  }

  /**
   * Get registry status summary
   */
  getStatus(): {
    totalAdapters: number;
    enabledAdapters: number;
    adapterDetails: Array<{
      name: string;
      description: string;
      enabled: boolean;
      registeredAt: Date;
      fileExtensions: string[];
    }>;
  } {
    const adapterDetails: Array<{
      name: string;
      description: string;
      enabled: boolean;
      registeredAt: Date;
      fileExtensions: string[];
    }> = [];

    for (const [name, registered] of this.adapters) {
      adapterDetails.push({
        name,
        description: registered.adapter.description,
        enabled: registered.enabled,
        registeredAt: registered.registeredAt,
        fileExtensions: registered.adapter.fileExtensions,
      });
    }

    return {
      totalAdapters: this.adapters.size,
      enabledAdapters: this.count(true),
      adapterDetails,
    };
  }
}

/**
 * Get the global adapter registry instance
 */
export function getAdapterRegistry(): AdapterRegistry {
  return AdapterRegistry.getInstance();
}
