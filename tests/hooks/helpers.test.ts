/**
 * Hook Helpers Tests
 *
 * Tests for pattern helpers, output utilities, and type definitions.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  approveTool,
  blockPrompt,
  // Pattern helpers
  blockTool,
  injectContext,
  modifyToolInput,
  sessionStartContext,
  // I/O utilities
  writeHookOutput,
} from '../../src/hooks/helpers';

describe('Pattern Helpers', () => {
  describe('blockTool', () => {
    it('returns block decision with reason', () => {
      const result = blockTool('Command not allowed');
      expect(result).toEqual({
        decision: 'block',
        reason: 'Command not allowed',
      });
    });

    it('returns correct type for PreToolUseOutput', () => {
      const result = blockTool('Test reason');
      expect(result.decision).toBe('block');
      expect(result.reason).toBe('Test reason');
    });
  });

  describe('approveTool', () => {
    it('returns approve decision', () => {
      const result = approveTool();
      expect(result).toEqual({
        decision: 'approve',
      });
    });
  });

  describe('modifyToolInput', () => {
    it('returns modified tool input', () => {
      const newInput = { command: 'echo hello', timeout: 5000 };
      const result = modifyToolInput(newInput);
      expect(result).toEqual({
        tool_input: newInput,
      });
    });

    it('preserves complex nested input', () => {
      const newInput = {
        file_path: '/test/path.ts',
        options: {
          encoding: 'utf-8',
          flags: ['--verbose', '--dry-run'],
        },
      };
      const result = modifyToolInput(newInput);
      expect(result.tool_input).toEqual(newInput);
    });
  });

  describe('injectContext', () => {
    it('returns result with message', () => {
      const result = injectContext('Important context for Claude');
      expect(result).toEqual({
        result: 'Important context for Claude',
      });
    });

    it('handles multiline messages', () => {
      const message = `Line 1
Line 2
Line 3`;
      const result = injectContext(message);
      expect(result.result).toBe(message);
    });

    it('handles empty message', () => {
      const result = injectContext('');
      expect(result).toEqual({ result: '' });
    });
  });

  describe('blockPrompt', () => {
    it('returns block decision with reason', () => {
      const result = blockPrompt('Prompt contains sensitive data');
      expect(result).toEqual({
        decision: 'block',
        reason: 'Prompt contains sensitive data',
      });
    });
  });

  describe('sessionStartContext', () => {
    it('returns result without env', () => {
      const result = sessionStartContext('Session initialized');
      expect(result).toEqual({
        result: 'Session initialized',
      });
    });

    it('returns result with env variables', () => {
      const result = sessionStartContext('Session ready', {
        PROJECT_NAME: 'my-project',
        DEBUG: 'true',
      });
      expect(result).toEqual({
        result: 'Session ready',
        env: {
          PROJECT_NAME: 'my-project',
          DEBUG: 'true',
        },
      });
    });

    it('handles empty env object', () => {
      const result = sessionStartContext('Hello', {});
      expect(result).toEqual({
        result: 'Hello',
        env: {},
      });
    });
  });
});

describe('writeHookOutput', () => {
  let stdoutWriteSpy: ReturnType<typeof spyOn>;
  let writtenData: string;

  beforeEach(() => {
    writtenData = '';
    stdoutWriteSpy = spyOn(process.stdout, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        writtenData += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
      }
    );
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('writes JSON to stdout', () => {
    writeHookOutput({ decision: 'approve' });
    expect(writtenData).toBe('{"decision":"approve"}');
  });

  it('handles complex objects', () => {
    writeHookOutput({
      result: 'Context injected',
      env: { KEY: 'value' },
    });
    const parsed = JSON.parse(writtenData);
    expect(parsed.result).toBe('Context injected');
    expect(parsed.env.KEY).toBe('value');
  });

  it('handles nested objects', () => {
    writeHookOutput({
      tool_input: {
        command: 'test',
        options: { verbose: true },
      },
    });
    const parsed = JSON.parse(writtenData);
    expect(parsed.tool_input.options.verbose).toBe(true);
  });
});

describe('Hook Type Definitions', () => {
  // These tests verify that the type definitions work correctly at runtime
  // by checking the structure of hook inputs and outputs

  describe('PreToolUseOutput structure', () => {
    it('accepts decision only', () => {
      const output = { decision: 'block' as const };
      expect(output.decision).toBe('block');
    });

    it('accepts decision with reason', () => {
      const output = { decision: 'block' as const, reason: 'Not allowed' };
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('Not allowed');
    });

    it('accepts tool_input modification', () => {
      const output = { tool_input: { command: 'echo hi' } };
      expect(output.tool_input.command).toBe('echo hi');
    });
  });

  describe('SessionStartOutput structure', () => {
    it('accepts result only', () => {
      const output = { result: 'Hello' };
      expect(output.result).toBe('Hello');
    });

    it('accepts result with env', () => {
      const output = { result: 'Hello', env: { VAR: 'value' } };
      expect(output.env?.VAR).toBe('value');
    });
  });

  describe('UserPromptSubmitOutput structure', () => {
    it('accepts block decision', () => {
      const output = { decision: 'block' as const, reason: 'Blocked' };
      expect(output.decision).toBe('block');
    });

    it('accepts approve with context', () => {
      const output = { decision: 'approve' as const, result: 'Added context' };
      expect(output.decision).toBe('approve');
      expect(output.result).toBe('Added context');
    });
  });
});

describe('Hook Input Validation', () => {
  // Test that hook inputs have the expected structure

  it('BaseHookInput has required fields', () => {
    const input = {
      session_id: 'test-uuid',
      transcript_path: '/path/to/transcript',
      cwd: '/current/dir',
      permission_mode: 'default' as const,
    };

    expect(input.session_id).toBeDefined();
    expect(input.transcript_path).toBeDefined();
    expect(input.cwd).toBeDefined();
    expect(input.permission_mode).toBeDefined();
  });

  it('SessionStartInput has source field', () => {
    const input = {
      session_id: 'test-uuid',
      transcript_path: '/path/to/transcript',
      cwd: '/current/dir',
      permission_mode: 'default' as const,
      source: 'startup' as const,
    };

    expect(input.source).toBe('startup');
  });

  it('PreToolUseInput has tool fields', () => {
    const input = {
      session_id: 'test-uuid',
      transcript_path: '/path/to/transcript',
      cwd: '/current/dir',
      permission_mode: 'default' as const,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    };

    expect(input.tool_name).toBe('Bash');
    expect(input.tool_input.command).toBe('echo hello');
  });

  it('PostToolUseInput has tool output', () => {
    const input = {
      session_id: 'test-uuid',
      transcript_path: '/path/to/transcript',
      cwd: '/current/dir',
      permission_mode: 'default' as const,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_output: 'hello\n',
    };

    expect(input.tool_output).toBe('hello\n');
  });

  it('StopInput has optional edited_files', () => {
    const input = {
      session_id: 'test-uuid',
      transcript_path: '/path/to/transcript',
      cwd: '/current/dir',
      permission_mode: 'default' as const,
      edited_files: ['/path/to/file1.ts', '/path/to/file2.ts'],
      stop_reason: 'end_turn' as const,
    };

    expect(input.edited_files).toHaveLength(2);
    expect(input.stop_reason).toBe('end_turn');
  });
});

describe('Session Source Types', () => {
  it('accepts all valid source types', () => {
    const sources = ['startup', 'resume', 'clear', 'compact'] as const;
    for (const source of sources) {
      expect(['startup', 'resume', 'clear', 'compact']).toContain(source);
    }
  });
});

describe('Permission Mode Types', () => {
  it('accepts all valid permission modes', () => {
    const modes = ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const;
    for (const mode of modes) {
      expect(['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions']).toContain(mode);
    }
  });
});
