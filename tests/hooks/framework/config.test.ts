/**
 * Config Loader and Validator Tests
 *
 * Tests for the YAML configuration system for the hook framework.
 * Covers:
 * - Valid YAML loading
 * - Invalid YAML error handling
 * - Missing file error handling
 * - Schema validation
 * - Default values
 * - Environment variable substitution
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import the config module
import {
  loadConfig,
  loadConfigFile,
  loadResolvedConfig,
  resolveConfig,
  configExists,
  getConfigPath,
  createDefaultConfig,
} from '../../../src/hooks/framework/config';

import {
  validateConfig,
  formatValidationErrors,
  isValidConfig,
} from '../../../src/hooks/framework/config';

import type {
  YamlConfig,
  ValidationResult,
  ResolvedConfig,
} from '../../../src/hooks/framework/config';

describe('Config Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-config-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadConfigFile', () => {
    it('loads valid YAML configuration file', () => {
      const configPath = path.join(tempDir, 'hooks.yaml');
      const configContent = `
version: 1
builtins:
  session-naming:
    enabled: true
  dangerous-command-guard:
    enabled: true
    options:
      blockedPatterns:
        - "rm -rf /"
        - "sudo rm"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(config).toBeDefined();
      expect(config.version).toBe(1);
      expect(config.builtins).toBeDefined();
      expect(config.builtins?.['session-naming']?.enabled).toBe(true);
      expect(config.builtins?.['dangerous-command-guard']?.enabled).toBe(true);
    });

    it('throws error for missing configuration file', () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent.yaml');

      expect(() => loadConfigFile(nonExistentPath)).toThrow(/not found/i);
    });

    it('throws error for invalid YAML syntax', () => {
      const configPath = path.join(tempDir, 'invalid.yaml');
      const invalidYaml = `
version: 1
builtins:
  session-naming:
    enabled: true
  invalid yaml here: [
`;
      fs.writeFileSync(configPath, invalidYaml, 'utf-8');

      expect(() => loadConfigFile(configPath)).toThrow();
    });

    it('handles empty configuration file', () => {
      const configPath = path.join(tempDir, 'empty.yaml');
      fs.writeFileSync(configPath, '', 'utf-8');

      // Empty file should throw or return minimal structure
      expect(() => loadConfigFile(configPath)).toThrow();
    });

    it('loads configuration with comments', () => {
      const configPath = path.join(tempDir, 'commented.yaml');
      const configContent = `
# Hook Framework Configuration
version: 1

# Handler definitions
builtins:
  # Session naming handler
  session-naming:
    enabled: true
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(config.version).toBe(1);
      expect(config.builtins?.['session-naming']?.enabled).toBe(true);
    });
  });

  describe('loadConfig (with validation)', () => {
    it('loads and validates valid configuration', () => {
      const configPath = path.join(tempDir, 'valid.yaml');
      const configContent = `
version: 1
settings:
  debug: true
builtins:
  session-naming:
    enabled: true
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfig(configPath);

      expect(config).toBeDefined();
      expect(config.version).toBe(1);
      expect(config.settings?.debug).toBe(true);
    });

    it('throws error for invalid configuration', () => {
      const configPath = path.join(tempDir, 'invalid-schema.yaml');
      const configContent = `
version: "invalid"
builtins:
  session-naming:
    enabled: true
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      expect(() => loadConfig(configPath)).toThrow(/invalid|version/i);
    });
  });

  describe('validateConfig', () => {
    it('passes validation for valid config', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails validation when version is missing', () => {
      const config = {
        builtins: {
          'session-naming': {
            enabled: true,
          },
        },
      } as YamlConfig;

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('version') || e.message.includes('version'))).toBe(true);
    });

    it('fails validation when version is wrong type', () => {
      const config = {
        version: '1' as any,
        builtins: {
          'session-naming': {
            enabled: true,
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('version'))).toBe(true);
    });

    it('fails validation for unknown built-in handler type', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'unknown-handler-type': {
            enabled: true,
          },
        } as any,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('unknown') || e.message.includes('Unknown'))).toBe(true);
    });

    it('validates handler-specific options', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
            options: {
              format: 'adjective-animal',
            },
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('fails validation for invalid handler options', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
            options: {
              format: 'invalid-format' as any,
            },
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('format'))).toBe(true);
    });

    it('validates error strategy values', () => {
      const config: YamlConfig = {
        version: 1,
        settings: {
          defaultErrorStrategy: 'invalid-strategy' as any,
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('defaultErrorStrategy'))).toBe(true);
    });

    it('validates event types in events array', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
            events: ['InvalidEvent' as any],
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('events'))).toBe(true);
    });

    it('validates dangerous-command-guard options', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: true,
            options: {
              blockedPatterns: ['rm -rf /'],
              strict: true,
            },
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('fails for invalid blockedPatterns type', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: true,
            options: {
              blockedPatterns: 'not-an-array' as any,
            },
          },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('blockedPatterns'))).toBe(true);
    });
  });

  describe('resolveConfig', () => {
    it('applies default settings when not specified', () => {
      const config: YamlConfig = {
        version: 1,
      };

      const resolved = resolveConfig(config);

      expect(resolved.settings.debug).toBe(false);
      expect(resolved.settings.parallelExecution).toBe(true);
      expect(resolved.settings.defaultTimeoutMs).toBe(30000);
      expect(resolved.settings.defaultErrorStrategy).toBe('continue');
    });

    it('preserves explicit settings over defaults', () => {
      const config: YamlConfig = {
        version: 1,
        settings: {
          debug: true,
          defaultTimeoutMs: 5000,
        },
      };

      const resolved = resolveConfig(config);

      expect(resolved.settings.debug).toBe(true);
      expect(resolved.settings.defaultTimeoutMs).toBe(5000);
    });

    it('applies default priority for built-in handlers', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
          },
          'dangerous-command-guard': {
            enabled: true,
          },
        },
      };

      const resolved = resolveConfig(config);

      const sessionNamer = resolved.handlers.find((h) => h.id === 'session-naming');
      const commandGuard = resolved.handlers.find((h) => h.id === 'dangerous-command-guard');

      expect(sessionNamer?.priority).toBe(10);
      expect(commandGuard?.priority).toBe(20);
    });

    it('applies default events for built-in handlers', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
          },
          'dangerous-command-guard': {
            enabled: true,
          },
        },
      };

      const resolved = resolveConfig(config);

      const sessionNamer = resolved.handlers.find((h) => h.id === 'session-naming');
      const commandGuard = resolved.handlers.find((h) => h.id === 'dangerous-command-guard');

      expect(sessionNamer?.events).toContain('SessionStart');
      expect(commandGuard?.events).toContain('PreToolUse');
    });

    it('respects explicit priority over defaults', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
            priority: 50,
          },
        },
      };

      const resolved = resolveConfig(config);

      const sessionNamer = resolved.handlers.find((h) => h.id === 'session-naming');
      expect(sessionNamer?.priority).toBe(50);
    });

    it('applies empty array default for after (dependencies)', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': {
            enabled: true,
          },
        },
      };

      const resolved = resolveConfig(config);

      const sessionNamer = resolved.handlers.find((h) => h.id === 'session-naming');
      expect(sessionNamer?.after).toEqual([]);
    });

    it('sorts handlers by priority', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'tool-logger': { enabled: true, priority: 100 },
          'session-naming': { enabled: true, priority: 10 },
          'dangerous-command-guard': { enabled: true, priority: 20 },
        },
      };

      const resolved = resolveConfig(config);

      expect(resolved.handlers[0].id).toBe('session-naming');
      expect(resolved.handlers[1].id).toBe('dangerous-command-guard');
      expect(resolved.handlers[2].id).toBe('tool-logger');
    });
  });

  describe('Environment Variable Substitution', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('substitutes ${VAR} syntax with environment variable', () => {
      process.env.MY_PATTERN = 'dangerous-pattern';

      const configPath = path.join(tempDir, 'env.yaml');
      const configContent = `
version: 1
builtins:
  dangerous-command-guard:
    enabled: true
    options:
      blockedPatterns:
        - "\${MY_PATTERN}"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(config.builtins?.['dangerous-command-guard']?.options?.blockedPatterns).toContain('dangerous-pattern');
    });

    it('handles ${VAR:-default} syntax for fallback values', () => {
      // Ensure the var is not set
      delete process.env.UNDEFINED_VAR;

      const configPath = path.join(tempDir, 'env-default.yaml');
      const configContent = `
version: 1
settings:
  debug: true
builtins:
  session-naming:
    enabled: true
    options:
      separator: "\${UNDEFINED_VAR:-_}"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(config.builtins?.['session-naming']?.options?.separator).toBe('_');
    });

    it('uses environment value over default when both available', () => {
      process.env.DEFINED_VAR = 'actual-value';

      const configPath = path.join(tempDir, 'env-override.yaml');
      const configContent = `
version: 1
builtins:
  session-naming:
    enabled: true
    options:
      separator: "\${DEFINED_VAR:-fallback-value}"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(config.builtins?.['session-naming']?.options?.separator).toBe('actual-value');
    });

    it('handles env vars in arrays', () => {
      process.env.PATTERN_1 = 'pattern-one';
      process.env.PATTERN_2 = 'pattern-two';

      const configPath = path.join(tempDir, 'env-array.yaml');
      const configContent = `
version: 1
builtins:
  dangerous-command-guard:
    enabled: true
    options:
      blockedPatterns:
        - "\${PATTERN_1}"
        - "static-pattern"
        - "\${PATTERN_2}"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      const patterns = config.builtins?.['dangerous-command-guard']?.options?.blockedPatterns as string[];
      expect(patterns).toContain('pattern-one');
      expect(patterns).toContain('static-pattern');
      expect(patterns).toContain('pattern-two');
    });
  });

  describe('Utility Functions', () => {
    it('configExists returns true for existing config', () => {
      const configPath = path.join(tempDir, 'hooks.yaml');
      fs.writeFileSync(configPath, 'version: 1', 'utf-8');

      expect(configExists(configPath)).toBe(true);
    });

    it('configExists returns false for non-existing config', () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent.yaml');

      expect(configExists(nonExistentPath)).toBe(false);
    });

    it('getConfigPath returns resolved path for existing config', () => {
      const configPath = path.join(tempDir, 'hooks.yaml');
      fs.writeFileSync(configPath, 'version: 1', 'utf-8');

      const resolved = getConfigPath(configPath);

      expect(resolved).toBe(path.resolve(configPath));
    });

    it('getConfigPath returns null for non-existing config', () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent.yaml');

      expect(getConfigPath(nonExistentPath)).toBeNull();
    });

    it('createDefaultConfig returns valid default config', () => {
      const defaultConfig = createDefaultConfig();

      expect(defaultConfig.version).toBe(1);
      expect(defaultConfig.settings).toBeDefined();
      expect(defaultConfig.builtins).toBeDefined();
      expect(defaultConfig.builtins?.['session-naming']).toBeDefined();
      expect(defaultConfig.builtins?.['dangerous-command-guard']).toBeDefined();

      // Default config should be valid
      const validation = validateConfig(defaultConfig);
      expect(validation.valid).toBe(true);
    });

    it('isValidConfig type guard works correctly', () => {
      const validConfig: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': { enabled: true },
        },
      };

      const invalidConfig = {
        version: 'invalid',
      };

      expect(isValidConfig(validConfig)).toBe(true);
      expect(isValidConfig(invalidConfig)).toBe(false);
    });

    it('formatValidationErrors produces readable output', () => {
      const result = validateConfig({ version: 'invalid' });

      const formatted = formatValidationErrors(result.errors);

      expect(formatted).toContain('version');
      expect(typeof formatted).toBe('string');
    });
  });

  describe('Edge Cases', () => {
    it('handles config with no handlers', () => {
      const config: YamlConfig = {
        version: 1,
        settings: {
          debug: true,
        },
      };

      const resolved = resolveConfig(config);

      expect(resolved.handlers).toEqual([]);
    });

    it('handles config with all handlers disabled', () => {
      const config: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': { enabled: false },
          'dangerous-command-guard': { enabled: false },
        },
      };

      const resolved = resolveConfig(config);

      for (const handler of resolved.handlers) {
        expect(handler.enabled).toBe(false);
      }
    });

    it('handles config with custom handlers', () => {
      const config: YamlConfig = {
        version: 1,
        handlers: {
          'my-custom-handler': {
            enabled: true,
            priority: 50,
            events: ['PostToolUse'],
          },
        },
      };

      const resolved = resolveConfig(config);

      const customHandler = resolved.handlers.find((h) => h.id === 'my-custom-handler');
      expect(customHandler).toBeDefined();
      expect(customHandler?.type).toBe('custom');
      expect(customHandler?.priority).toBe(50);
      expect(customHandler?.events).toContain('PostToolUse');
    });

    it('handles very long config files', () => {
      const configPath = path.join(tempDir, 'long.yaml');
      const handlers: string[] = [];
      for (let i = 0; i < 50; i++) {
        handlers.push(`  handler-${i}:\n    enabled: true\n    priority: ${i}`);
      }
      const configContent = `version: 1\nhandlers:\n${handlers.join('\n')}`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      const config = loadConfigFile(configPath);

      expect(Object.keys(config.handlers || {}).length).toBe(50);
    });
  });
});
