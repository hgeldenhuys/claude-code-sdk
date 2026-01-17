/**
 * Integration Tests for Hook Framework Config System
 *
 * End-to-end tests that verify:
 * - Load config -> create framework -> execute pipeline
 * - Handlers execute in correct order (respecting dependencies)
 * - Built-in handlers work with custom handlers
 * - Config changes are reflected in behavior
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import framework and config modules
import {
  createFramework,
  HookFramework,
  handler,
  handlerResult,
  blockResult,
} from '../../../src/hooks/framework';
import type { PipelineContext, HandlerDefinition } from '../../../src/hooks/framework/types';

// Import config loader
import {
  loadConfig,
  loadResolvedConfig,
  resolveConfig,
  type YamlConfig,
  type ResolvedConfig,
} from '../../../src/hooks/framework/config';

// Import built-in handlers
import { createSessionNamingHandler } from '../../../src/hooks/framework/handlers/session-naming';
import { createDangerousCommandGuardHandler } from '../../../src/hooks/framework/handlers/dangerous-command-guard';

describe('Integration: Config to Framework', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('End-to-End Config Flow', () => {
    it('loads config and resolves handlers correctly', () => {
      // 1. Create config file
      const configPath = path.join(tempDir, 'hooks.yaml');
      const configContent = `
version: 1
builtins:
  session-naming:
    enabled: true
    priority: 10
  dangerous-command-guard:
    enabled: true
    priority: 20
    options:
      blockedPatterns:
        - "rm -rf /"
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');

      // 2. Load and resolve config
      const config = loadConfig(configPath);
      expect(config.builtins?.['session-naming']).toBeDefined();
      expect(config.builtins?.['dangerous-command-guard']).toBeDefined();

      const resolved = resolveConfig(config);
      expect(resolved.handlers).toHaveLength(2);

      // 3. Verify handlers are correctly resolved
      const sessionNamer = resolved.handlers.find((h) => h.id === 'session-naming');
      const commandGuard = resolved.handlers.find((h) => h.id === 'dangerous-command-guard');

      expect(sessionNamer).toBeDefined();
      expect(sessionNamer?.priority).toBe(10);
      expect(commandGuard).toBeDefined();
      expect(commandGuard?.priority).toBe(20);
    });

    it('creates framework and executes built-in handlers', async () => {
      // Create framework
      const framework = createFramework({ debug: false });

      // Add session naming handler
      const sessionHandler = createSessionNamingHandler({});
      framework.onSessionStart(sessionHandler);

      // Execute pipeline with test event
      const result = await framework.execute('SessionStart', {
        session_id: 'test-session',
        transcript_path: '/path/to/transcript',
        cwd: '/test/project',
        permission_mode: 'default',
        source: 'startup',
      } as any);

      expect(result.success).toBe(true);
      expect(result.executedHandlers.length).toBeGreaterThan(0);
    });

    it('blocks dangerous commands through command guard handler', async () => {
      const framework = createFramework({ debug: false });

      // Add dangerous command guard
      const guardHandler = createDangerousCommandGuardHandler({
        blockedPatterns: ['rm -rf /'],
      });
      framework.onPreToolUse(guardHandler);

      // Test dangerous command
      const result = await framework.execute('PreToolUse', {
        session_id: 'test-session',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      } as any);

      expect(result.hookOutput.decision).toBe('block');
    });

    it('allows safe commands through command guard handler', async () => {
      const framework = createFramework({ debug: false });

      // Add dangerous command guard
      const guardHandler = createDangerousCommandGuardHandler({});
      framework.onPreToolUse(guardHandler);

      const result = await framework.execute('PreToolUse', {
        session_id: 'test-session',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      } as any);

      expect(result.hookOutput.decision).not.toBe('block');
    });
  });

  describe('Handler Execution Order', () => {
    it('executes handlers in priority order', async () => {
      const executionOrder: string[] = [];

      const framework = createFramework<{ order: string[] }>({
        initialState: () => ({ order: [] }),
      });

      // Add handlers with different priorities
      framework.onPreToolUse(
        handler<{ order: string[] }>()
          .id('low-priority')
          .priority(100)
          .handle((ctx) => {
            executionOrder.push('low-priority');
            ctx.state.order.push('low-priority');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler<{ order: string[] }>()
          .id('high-priority')
          .priority(10)
          .handle((ctx) => {
            executionOrder.push('high-priority');
            ctx.state.order.push('high-priority');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler<{ order: string[] }>()
          .id('medium-priority')
          .priority(50)
          .handle((ctx) => {
            executionOrder.push('medium-priority');
            ctx.state.order.push('medium-priority');
            return handlerResult();
          })
      );

      const result = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      } as any);

      expect(executionOrder).toEqual(['high-priority', 'medium-priority', 'low-priority']);
    });

    it('respects dependencies between handlers', async () => {
      const executionOrder: string[] = [];

      const framework = createFramework();

      // Handler B depends on Handler A
      framework.onPreToolUse(
        handler()
          .id('handler-a')
          .priority(100) // Lower priority, but should still run first due to dependency
          .handle(() => {
            executionOrder.push('handler-a');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler()
          .id('handler-b')
          .priority(10) // Higher priority, but depends on A
          .after('handler-a')
          .handle(() => {
            executionOrder.push('handler-b');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler()
          .id('handler-c')
          .priority(50)
          .after('handler-b') // Depends on B
          .handle(() => {
            executionOrder.push('handler-c');
            return handlerResult();
          })
      );

      await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: {},
      } as any);

      // A must run before B, B must run before C
      expect(executionOrder.indexOf('handler-a')).toBeLessThan(executionOrder.indexOf('handler-b'));
      expect(executionOrder.indexOf('handler-b')).toBeLessThan(executionOrder.indexOf('handler-c'));
    });

    it('handles diamond dependencies correctly', async () => {
      const executionOrder: string[] = [];

      const framework = createFramework();

      //     A
      //    / \
      //   B   C
      //    \ /
      //     D

      framework.onPreToolUse(
        handler()
          .id('A')
          .handle(() => {
            executionOrder.push('A');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler()
          .id('B')
          .after('A')
          .handle(() => {
            executionOrder.push('B');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler()
          .id('C')
          .after('A')
          .handle(() => {
            executionOrder.push('C');
            return handlerResult();
          })
      );

      framework.onPreToolUse(
        handler()
          .id('D')
          .after('B', 'C')
          .handle(() => {
            executionOrder.push('D');
            return handlerResult();
          })
      );

      await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: {},
      } as any);

      // A must run before B and C
      expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('B'));
      expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('C'));
      // B and C must run before D
      expect(executionOrder.indexOf('B')).toBeLessThan(executionOrder.indexOf('D'));
      expect(executionOrder.indexOf('C')).toBeLessThan(executionOrder.indexOf('D'));
    });
  });

  describe('Built-in and Custom Handlers Together', () => {
    it('combines built-in handlers with custom handlers', async () => {
      const framework = createFramework({ debug: false });

      // Add built-in guard
      const guardHandler = createDangerousCommandGuardHandler({});
      framework.onPreToolUse(guardHandler);

      // Add custom handler
      let customHandlerRan = false;
      framework.onPreToolUse(
        handler()
          .id('custom-logger')
          .priority(200)
          .handle(() => {
            customHandlerRan = true;
            return handlerResult();
          })
      );

      const result = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      } as any);

      expect(result.success).toBe(true);
      expect(customHandlerRan).toBe(true);
      expect(result.executedHandlers).toContain('dangerous-command-guard');
      expect(result.executedHandlers).toContain('custom-logger');
    });

    it('custom handler can depend on built-in handler', async () => {
      const executionOrder: string[] = [];

      const framework = createFramework<{ sessionName?: string }>();

      // Add session naming handler
      const sessionHandler = createSessionNamingHandler({});
      framework.onSessionStart(sessionHandler);

      // Custom handler that depends on session-namer
      framework.onSessionStart(
        handler<{ sessionName?: string }>()
          .id('after-naming')
          .after('session-naming')
          .handle((ctx) => {
            executionOrder.push('after-naming');
            // Should have access to session name from state
            return handlerResult();
          })
      );

      await framework.execute('SessionStart', {
        session_id: 'test-session',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        source: 'startup',
      } as any);

      expect(executionOrder).toContain('after-naming');
    });
  });

  describe('Config Changes Reflected in Behavior', () => {
    it('disabling handler removes it from execution', async () => {
      // First config with handler enabled
      const enabledConfig: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: true,
          },
        },
      };

      const enabledResolved = resolveConfig(enabledConfig);
      expect(enabledResolved.handlers.find((h) => h.id === 'dangerous-command-guard')?.enabled).toBe(
        true
      );

      // Config with handler disabled
      const disabledConfig: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: false,
          },
        },
      };

      const disabledResolved = resolveConfig(disabledConfig);
      expect(disabledResolved.handlers.find((h) => h.id === 'dangerous-command-guard')?.enabled).toBe(
        false
      );
    });

    it('changing blocked patterns updates resolved config', () => {
      // Config with minimal patterns
      const config1: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: true,
            options: {
              blockedPatterns: ['rm -rf /'],
            },
          },
        },
      };

      const resolved1 = resolveConfig(config1);
      const handler1 = resolved1.handlers.find((h) => h.id === 'dangerous-command-guard');
      expect((handler1?.options as any).blockedPatterns).toEqual(['rm -rf /']);

      // Config with more patterns
      const config2: YamlConfig = {
        version: 1,
        builtins: {
          'dangerous-command-guard': {
            enabled: true,
            options: {
              blockedPatterns: ['rm -rf /', 'sudo rm', 'dd if='],
            },
          },
        },
      };

      const resolved2 = resolveConfig(config2);
      const handler2 = resolved2.handlers.find((h) => h.id === 'dangerous-command-guard');
      expect((handler2?.options as any).blockedPatterns).toHaveLength(3);
    });

    it('changing handler priority affects resolved order', () => {
      const config1: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': { enabled: true, priority: 10 },
          'dangerous-command-guard': { enabled: true, priority: 20 },
        },
      };

      const resolved1 = resolveConfig(config1);
      expect(resolved1.handlers[0].id).toBe('session-naming');
      expect(resolved1.handlers[1].id).toBe('dangerous-command-guard');

      // Swap priorities
      const config2: YamlConfig = {
        version: 1,
        builtins: {
          'session-naming': { enabled: true, priority: 30 },
          'dangerous-command-guard': { enabled: true, priority: 5 },
        },
      };

      const resolved2 = resolveConfig(config2);
      expect(resolved2.handlers[0].id).toBe('dangerous-command-guard');
      expect(resolved2.handlers[1].id).toBe('session-naming');
    });
  });

  describe('Error Handling in Integration', () => {
    it('handles config with missing file gracefully', () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yaml');

      expect(() => loadConfig(nonExistentPath)).toThrow();
    });

    it('handles invalid YAML in config file', () => {
      const configPath = path.join(tempDir, 'invalid.yaml');
      fs.writeFileSync(configPath, 'invalid: yaml: [', 'utf-8');

      expect(() => loadConfig(configPath)).toThrow();
    });

    it('handles handler errors without crashing pipeline', async () => {
      const framework = createFramework();

      framework.onPreToolUse(
        handler()
          .id('error-handler')
          .onError('continue')
          .handle(() => {
            throw new Error('Handler error');
          })
      );

      framework.onPreToolUse(
        handler()
          .id('after-error')
          .handle(() => {
            return handlerResult({ ranAfterError: true });
          })
      );

      const result = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: {},
      } as any);

      // Pipeline should continue despite error
      expect(result.failedHandlers).toContain('error-handler');
      expect(result.executedHandlers).toContain('after-error');
    });

    it('stops pipeline on error when configured', async () => {
      const framework = createFramework();

      framework.onPreToolUse(
        handler()
          .id('error-handler')
          .onError('stop')
          .handle(() => {
            throw new Error('Critical error');
          })
      );

      let afterErrorRan = false;
      framework.onPreToolUse(
        handler()
          .id('after-error')
          .after('error-handler')
          .handle(() => {
            afterErrorRan = true;
            return handlerResult();
          })
      );

      const result = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: {},
      } as any);

      expect(result.failedHandlers).toContain('error-handler');
      expect(afterErrorRan).toBe(false);
    });
  });

  describe('Full Pipeline Flow', () => {
    it('executes complete SessionStart flow', async () => {
      const framework = createFramework();

      // Add session naming handler
      const sessionHandler = createSessionNamingHandler({});
      framework.onSessionStart(sessionHandler);

      // Add custom context injection
      framework.onSessionStart(
        handler()
          .id('welcome-context')
          .priority(50)
          .handle(() => {
            return {
              success: true,
              durationMs: 0,
              contextToInject: 'Welcome to the session!',
            };
          })
      );

      const result = await framework.execute('SessionStart', {
        session_id: 'new-session-123',
        transcript_path: '/path/to/transcript',
        cwd: '/test/project',
        permission_mode: 'default',
        source: 'startup',
      } as any);

      expect(result.success).toBe(true);
      expect(result.executedHandlers).toContain('session-naming');
      expect(result.executedHandlers).toContain('welcome-context');
      expect(result.hookOutput.context).toContain('Session:');
      expect(result.hookOutput.context).toContain('Welcome to the session!');
    });

    it('executes complete PreToolUse validation flow', async () => {
      const framework = createFramework();

      // Add dangerous command guard
      const guardHandler = createDangerousCommandGuardHandler({});
      framework.onPreToolUse(guardHandler);

      // Add custom logger
      let loggedCommand: string | undefined;
      framework.onPreToolUse(
        handler()
          .id('command-logger')
          .priority(200)
          .handle((ctx) => {
            const event = ctx.event as any;
            loggedCommand = event.tool_input?.command;
            return handlerResult();
          })
      );

      // Safe command
      const safeResult = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
      } as any);

      expect(safeResult.success).toBe(true);
      expect(safeResult.hookOutput.decision).not.toBe('block');
      expect(loggedCommand).toBe('git status');

      // Dangerous command
      const dangerousResult = await framework.execute('PreToolUse', {
        session_id: 'test',
        transcript_path: '/path',
        cwd: '/test',
        permission_mode: 'default',
        tool_name: 'Bash',
        tool_input: { command: ':(){ :|:& };:' },
      } as any);

      expect(dangerousResult.hookOutput.decision).toBe('block');
    });
  });

  describe('Resolved Config to Framework', () => {
    it('creates handlers from resolved config', () => {
      const config: YamlConfig = {
        version: 1,
        settings: {
          debug: false,
          parallelExecution: true,
        },
        builtins: {
          'session-naming': {
            enabled: true,
            options: {
              format: 'adjective-animal',
            },
          },
          'dangerous-command-guard': {
            enabled: true,
            options: {
              blockedPatterns: ['custom-pattern'],
              strict: false,
            },
          },
        },
      };

      const resolved = resolveConfig(config);

      // Create framework with resolved settings
      const framework = createFramework({
        debug: resolved.settings.debug,
        defaultTimeoutMs: resolved.settings.defaultTimeoutMs,
        defaultErrorStrategy: resolved.settings.defaultErrorStrategy,
      });

      // Add handlers based on resolved config
      for (const handlerConfig of resolved.handlers) {
        if (!handlerConfig.enabled) continue;

        if (handlerConfig.type === 'session-naming') {
          const handler = createSessionNamingHandler(handlerConfig.options as any);
          for (const event of handlerConfig.events) {
            if (event === 'SessionStart') {
              framework.onSessionStart(handler);
            }
          }
        } else if (handlerConfig.type === 'dangerous-command-guard') {
          const handler = createDangerousCommandGuardHandler(handlerConfig.options as any);
          for (const event of handlerConfig.events) {
            if (event === 'PreToolUse') {
              framework.onPreToolUse(handler);
            }
          }
        }
      }

      // Verify handlers were registered
      expect(framework.getHandlers('SessionStart').length).toBeGreaterThan(0);
      expect(framework.getHandlers('PreToolUse').length).toBeGreaterThan(0);
    });
  });
});
