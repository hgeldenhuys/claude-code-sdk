import { describe, test, expect } from 'bun:test';
import { PluginManager } from '../src/plugins/index.ts';
import type { Plugin, PluginType } from '../src/types/index.ts';

describe('PluginManager', () => {
  test('should create manager with default config', () => {
    const manager = new PluginManager();
    expect(manager).toBeDefined();
  });

  test('should create manager with custom config', () => {
    const manager = new PluginManager({
      pluginsDir: '/custom/plugins',
      autoLoad: false,
    });
    expect(manager).toBeDefined();
  });

  test('getAll should return empty array initially', () => {
    const manager = new PluginManager();
    expect(manager.getAll()).toEqual([]);
  });

  test('isInstalled should return false for unknown plugin', () => {
    const manager = new PluginManager();
    expect(manager.isInstalled('unknown-plugin')).toBe(false);
  });

  test('isEnabled should return false for unknown plugin', () => {
    const manager = new PluginManager();
    expect(manager.isEnabled('unknown-plugin')).toBe(false);
  });

  test('getHooks should return empty array for unknown event', () => {
    const manager = new PluginManager();
    expect(manager.getHooks('unknown-event')).toEqual([]);
  });

  describe('validate', () => {
    test('should validate a complete plugin', () => {
      const plugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        type: 'skill',
        entryPoint: 'index.ts',
      };

      const result = new PluginManager().validate(plugin);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('should reject plugin without required fields', () => {
      const plugin = {
        name: 'Incomplete Plugin',
      } as Plugin;

      const result = new PluginManager().validate(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject plugin with invalid type', () => {
      const plugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        type: 'invalid-type' as PluginType,
        entryPoint: 'index.ts',
      };

      const result = new PluginManager().validate(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid plugin type: invalid-type');
    });
  });
});
