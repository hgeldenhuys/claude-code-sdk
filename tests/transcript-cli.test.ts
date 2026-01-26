/**
 * Transcript CLI Tests
 *
 * Tests for the transcript CLI (bin/transcript.ts)
 * Covers existing functionality and new TRANSCRIPT-002 enhancements
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import {
  filterLines,
  formatMinimal,
  formatJson,
  renderLine,
  getDisplayType,
  getPreview,
  extractAllText,
  getSessionMetadata,
  type FilterOptions,
} from '../src/transcripts/viewer';
import { parseTranscript } from '../src/transcripts/parser';
import type { TranscriptLine } from '../src/transcripts/types';

// ============================================================================
// Test Data
// ============================================================================

// Sample transcript with various message types and timestamps
const sampleTranscript = `{"type":"user","uuid":"u1","sessionId":"session-123","timestamp":"2024-01-01T10:00:00Z","cwd":"/project","slug":"test-session","message":{"role":"user","content":"Hello, can you help me?"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"session-123","timestamp":"2024-01-01T10:00:05Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me think about this..."},{"type":"text","text":"Hi there! I'd be happy to help."}],"model":"claude-3-opus"}}
{"type":"assistant","uuid":"a2","parentUuid":"u1","sessionId":"session-123","timestamp":"2024-01-01T10:00:10Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/project/data.json"}}]}}
{"type":"user","uuid":"u2","parentUuid":"a2","sessionId":"session-123","timestamp":"2024-01-01T10:00:15Z","cwd":"/project","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-1","content":"{\\"key\\": \\"value\\"}"}]}}
{"type":"assistant","uuid":"a3","parentUuid":"u2","sessionId":"session-123","timestamp":"2024-01-01T10:00:20Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"text","text":"I found the data. The key is 'value'."}],"usage":{"input_tokens":100,"output_tokens":50}}}
{"type":"summary","uuid":"s1","sessionId":"session-123","timestamp":"2024-01-01T10:00:25Z","cwd":"/project","summary":"Helped user read a JSON file","leafUuid":"a3"}`;

// Extended transcript with more timestamps for testing --from/--to
const timestampTranscript = `{"type":"user","uuid":"t1","sessionId":"session-456","timestamp":"2024-06-15T08:00:00Z","cwd":"/project","message":{"role":"user","content":"Morning message"}}
{"type":"assistant","uuid":"t2","parentUuid":"t1","sessionId":"session-456","timestamp":"2024-06-15T12:00:00Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"text","text":"Noon response"}]}}
{"type":"user","uuid":"t3","parentUuid":"t2","sessionId":"session-456","timestamp":"2024-06-15T18:00:00Z","cwd":"/project","message":{"role":"user","content":"Evening question"}}
{"type":"assistant","uuid":"t4","parentUuid":"t3","sessionId":"session-456","timestamp":"2024-06-15T23:00:00Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"text","text":"Night answer"}]}}`;

// ============================================================================
// Test Fixtures
// ============================================================================

let tempDir: string;
let testFile: string;
let timestampFile: string;

beforeAll(async () => {
  // Create temp directory for test files
  tempDir = await mkdtemp(join(tmpdir(), 'transcript-cli-test-'));
  testFile = join(tempDir, 'test-transcript.jsonl');
  timestampFile = join(tempDir, 'timestamp-transcript.jsonl');

  // Write test files
  await Bun.write(testFile, sampleTranscript);
  await Bun.write(timestampFile, timestampTranscript);
});

afterAll(async () => {
  // Cleanup temp directory
  await rm(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Core Viewer Module Tests
// ============================================================================

describe('Transcript Viewer Module', () => {
  describe('filterLines', () => {
    const lines = parseTranscript(sampleTranscript);

    test('filters by type', () => {
      const opts: FilterOptions = { types: ['user'] };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      for (const line of filtered) {
        expect(line.type).toBe('user');
      }
    });

    test('filters with userPrompts convenience flag', () => {
      const opts: FilterOptions = { userPrompts: true };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      for (const line of filtered) {
        expect(line.type).toBe('user');
      }
    });

    test('filters with assistant convenience flag', () => {
      const opts: FilterOptions = { assistant: true };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(3);
      for (const line of filtered) {
        expect(line.type).toBe('assistant');
      }
    });

    test('filters with tools flag', () => {
      const opts: FilterOptions = { tools: true };
      const filtered = filterLines(lines, opts);

      // Should get tool_use and tool_result lines
      expect(filtered.length).toBe(2);
    });

    test('filters with thinking flag', () => {
      const opts: FilterOptions = { thinking: true };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(1);
      expect(filtered[0]?.uuid).toBe('a1');
    });

    test('filters with textOnly flag', () => {
      const opts: FilterOptions = { textOnly: true };
      const filtered = filterLines(lines, opts);

      // Should only include assistant lines with text blocks
      expect(filtered.length).toBeGreaterThan(0);
      for (const line of filtered) {
        expect(line.type).toBe('assistant');
      }
    });

    test('filters by search term', () => {
      const opts: FilterOptions = { search: 'JSON' };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBeGreaterThan(0);
      for (const line of filtered) {
        const text = extractAllText(line);
        expect(text.toLowerCase()).toContain('json');
      }
    });

    test('filters with last N', () => {
      const opts: FilterOptions = { last: 2 };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      expect(filtered[0]?.uuid).toBe('a3');
      expect(filtered[1]?.uuid).toBe('s1');
    });

    test('filters with first N', () => {
      const opts: FilterOptions = { first: 2 };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      expect(filtered[0]?.uuid).toBe('u1');
      expect(filtered[1]?.uuid).toBe('a1');
    });

    test('filters by line range', () => {
      const opts: FilterOptions = { fromLine: 2, toLine: 4 };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(3);
      expect(filtered[0]?.lineNumber).toBe(2);
      expect(filtered[2]?.lineNumber).toBe(4);
    });

    test('filters with offset and limit', () => {
      const opts: FilterOptions = { offset: 1, limit: 2 };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      expect(filtered[0]?.uuid).toBe('a1');
      expect(filtered[1]?.uuid).toBe('a2');
    });

    test('combines multiple filters', () => {
      const opts: FilterOptions = {
        assistant: true,
        last: 2,
      };
      const filtered = filterLines(lines, opts);

      expect(filtered.length).toBe(2);
      for (const line of filtered) {
        expect(line.type).toBe('assistant');
      }
    });
  });

  describe('extractAllText', () => {
    const lines = parseTranscript(sampleTranscript);

    test('extracts text from user message string content', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const text = extractAllText(userLine!);

      expect(text).toContain('Hello, can you help me?');
    });

    test('extracts text from assistant with thinking and text blocks', () => {
      const assistantLine = lines.find((l) => l.uuid === 'a1');
      const text = extractAllText(assistantLine!);

      expect(text).toContain('Let me think about this');
      expect(text).toContain("Hi there! I'd be happy to help.");
    });

    test('extracts tool name from tool_use block', () => {
      const toolUseLine = lines.find((l) => l.uuid === 'a2');
      const text = extractAllText(toolUseLine!);

      expect(text).toContain('Tool: Read');
    });

    test('extracts content from tool_result', () => {
      const toolResultLine = lines.find((l) => l.uuid === 'u2');
      const text = extractAllText(toolResultLine!);

      expect(text).toContain('key');
      expect(text).toContain('value');
    });
  });

  describe('getDisplayType', () => {
    const lines = parseTranscript(sampleTranscript);

    test('returns user for user message', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      expect(getDisplayType(userLine!)).toBe('user');
    });

    test('returns tool_use for assistant with tool_use blocks', () => {
      const toolUseLine = lines.find((l) => l.uuid === 'a2');
      expect(getDisplayType(toolUseLine!)).toBe('tool_use');
    });

    test('returns tool_result for user with tool_result', () => {
      const toolResultLine = lines.find((l) => l.uuid === 'u2');
      expect(getDisplayType(toolResultLine!)).toBe('tool_result');
    });

    test('returns summary for summary type', () => {
      const summaryLine = lines.find((l) => l.uuid === 's1');
      expect(getDisplayType(summaryLine!)).toBe('summary');
    });

    test('returns hook_progress for progress type with hook_progress data', () => {
      const progressLine: TranscriptLine = {
        lineNumber: 1,
        type: 'progress',
        uuid: 'test-progress',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        data: { type: 'hook_progress', hookEvent: 'Stop', hookName: 'Stop' },
        raw: '{}',
      };
      expect(getDisplayType(progressLine)).toBe('hook_progress');
    });

    test('returns system:subtype for system with subtype', () => {
      const systemLine: TranscriptLine = {
        lineNumber: 1,
        type: 'system',
        uuid: 'test-system',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        subtype: 'stop_hook_summary',
        raw: '{}',
      };
      expect(getDisplayType(systemLine)).toBe('system:stop_hook_summary');
    });
  });

  describe('extractAllText with progress/system types', () => {
    test('extracts hook name from hook_progress', () => {
      const progressLine: TranscriptLine = {
        lineNumber: 1,
        type: 'progress',
        uuid: 'test-progress',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        data: { type: 'hook_progress', hookEvent: 'Stop', hookName: 'MyHook' },
        raw: '{}',
      };
      const text = extractAllText(progressLine);
      expect(text).toContain('Hook: MyHook');
    });

    test('extracts hook count from stop_hook_summary', () => {
      const systemLine: TranscriptLine = {
        lineNumber: 1,
        type: 'system',
        uuid: 'test-system',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        subtype: 'stop_hook_summary',
        hookInfos: [{ command: 'hook1.ts' }, { command: 'hook2.ts' }],
        raw: '{}',
      };
      const text = extractAllText(systemLine);
      expect(text).toContain('2 hook(s) executed');
    });

    test('extracts duration from turn_duration', () => {
      const systemLine: TranscriptLine = {
        lineNumber: 1,
        type: 'system',
        uuid: 'test-system',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        subtype: 'turn_duration',
        raw: '{"durationMs":65000}',
      };
      const text = extractAllText(systemLine);
      expect(text).toContain('Turn: 1m 5s');
    });

    test('extracts summary from summary type', () => {
      const summaryLine: TranscriptLine = {
        lineNumber: 1,
        type: 'summary',
        uuid: 'test-summary',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        summary: 'This is a test summary',
        raw: '{}',
      };
      const text = extractAllText(summaryLine);
      expect(text).toContain('This is a test summary');
    });
  });

  describe('getPreview', () => {
    const lines = parseTranscript(sampleTranscript);

    test('truncates long text with ellipsis', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const preview = getPreview(userLine!, 10);

      expect(preview.length).toBeLessThanOrEqual(13); // 10 + "..."
      expect(preview).toContain('...');
    });

    test('returns full text for short content', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const preview = getPreview(userLine!, 100);

      expect(preview).not.toContain('...');
    });

    test('returns (empty) for lines without content', () => {
      const emptyLine = {
        lineNumber: 1,
        type: 'system' as const,
        uuid: 'empty',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2024-01-01T10:00:00Z',
        cwd: '/project',
        raw: '{}',
      };

      const preview = getPreview(emptyLine, 80);
      expect(preview).toBe('(empty)');
    });
  });

  describe('renderLine', () => {
    const lines = parseTranscript(sampleTranscript);

    test('renders user message with header', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const rendered = renderLine(userLine!);

      expect(rendered.fullContent).toContain('Line 1');
      expect(rendered.fullContent).toContain('[user]');
      expect(rendered.fullContent).toContain('User:');
    });

    test('renders assistant message with model info', () => {
      const assistantLine = lines.find((l) => l.uuid === 'a1');
      const rendered = renderLine(assistantLine!);

      expect(rendered.fullContent).toContain('[assistant]');
      expect(rendered.fullContent).toContain('Assistant:');
      expect(rendered.fullContent).toContain('claude-3-opus');
    });

    test('renders tool_use with tool name', () => {
      const toolUseLine = lines.find((l) => l.uuid === 'a2');
      const rendered = renderLine(toolUseLine!);

      expect(rendered.fullContent).toContain('[Tool: Read]');
      expect(rendered.fullContent).toContain('file_path');
    });

    test('includes session name in metadata', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const rendered = renderLine(userLine!);

      expect(rendered.metadata.slug).toBe('test-session');
    });
  });

  describe('formatMinimal', () => {
    const lines = parseTranscript(sampleTranscript);

    test('returns just the text content', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const minimal = formatMinimal(userLine!);

      expect(minimal).toBe('Hello, can you help me?');
    });

    test('returns empty string for lines without content', () => {
      const emptyLine = {
        lineNumber: 1,
        type: 'system' as const,
        uuid: 'empty',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2024-01-01T10:00:00Z',
        cwd: '/project',
        raw: '{}',
      };

      const minimal = formatMinimal(emptyLine);
      expect(minimal).toBe('');
    });
  });

  describe('formatJson', () => {
    const lines = parseTranscript(sampleTranscript);

    test('returns raw JSON', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const json = formatJson(userLine!);

      expect(json).toBe(userLine!.raw);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    test('returns pretty-printed JSON when requested', () => {
      const userLine = lines.find((l) => l.uuid === 'u1');
      const pretty = formatJson(userLine!, true);

      expect(pretty).toContain('\n');
      expect(pretty).toContain('  '); // indentation
    });
  });

  describe('getSessionMetadata', () => {
    const lines = parseTranscript(sampleTranscript);

    test('extracts session info from lines', () => {
      const metadata = getSessionMetadata(lines);

      expect(metadata.lineCount).toBe(6);
      expect(metadata.sessionId).toBe('session-123');
      expect(metadata.sessionName).toBe('test-session');
    });

    test('includes time range', () => {
      const metadata = getSessionMetadata(lines);

      expect(metadata.firstTimestamp).toBe('2024-01-01T10:00:00Z');
      expect(metadata.lastTimestamp).toBe('2024-01-01T10:00:25Z');
    });

    test('includes type counts', () => {
      const metadata = getSessionMetadata(lines);
      const typeCounts = metadata.typeCounts as Record<string, number>;

      expect(typeCounts.user).toBe(1); // user with text, tool_result shows as tool_result
      expect(typeCounts.tool_result).toBe(1);
      expect(typeCounts.tool_use).toBe(1);
      expect(typeCounts.summary).toBe(1);
    });
  });
});

// ============================================================================
// CLI Integration Tests
// ============================================================================

// CLI integration tests skipped - bin/transcript.ts migrated to Rust (transcript-tui-rs/crates/transcript-cli)
describe.skip('Transcript CLI', () => {
  const cliPath = join(
    process.cwd(),
    'bin/transcript.ts'
  );

  describe('help command', () => {
    test('shows help with --help flag', async () => {
      const result = await $`bun ${cliPath} --help`.text();

      expect(result).toContain('transcript');
      expect(result).toContain('View transcript');
      expect(result).toContain('--type');
      expect(result).toContain('--last');
    });

    test('shows help with help command', async () => {
      const result = await $`bun ${cliPath} help`.text();

      expect(result).toContain('transcript');
      expect(result).toContain('Usage:');
    });
  });

  describe('version command', () => {
    test('shows version', async () => {
      const result = await $`bun ${cliPath} --version`.text();

      expect(result).toContain('transcript v');
    });
  });

  describe('view command', () => {
    test('views transcript file', async () => {
      const result = await $`bun ${cliPath} ${testFile}`.text();

      // Should show raw JSON lines by default
      expect(result).toContain('user');
      expect(result).toContain('assistant');
    });

    test('views with --json flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --json`.text();

      // Each line should be valid JSON
      const lines = result.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      }
    });

    test('views with --human flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --human`.text();

      expect(result).toContain('Line');
      expect(result).toContain('[user]');
      expect(result).toContain('User:');
    });

    test('views with --minimal flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --minimal`.text();

      // Should contain just the text content
      expect(result).toContain('Hello, can you help me?');
      expect(result).not.toContain('uuid');
      expect(result).not.toContain('timestamp');
    });

    test('filters with --user-prompts flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --user-prompts --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBe('user');
      }
    });

    test('filters with --assistant flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --assistant --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(3);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBe('assistant');
      }
    });

    test('filters with --type flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --type summary --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.type).toBe('summary');
    });

    test('filters with --last flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --last 2 --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2);
    });

    test('filters with --first flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --first 2 --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2);

      // First should be the first user message
      const first = JSON.parse(lines[0]!);
      expect(first.uuid).toBe('u1');
    });

    test('filters with --from and --to flags', async () => {
      const result = await $`bun ${cliPath} ${testFile} --from 2 --to 4 --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(3);
    });

    test('filters with --search flag', async () => {
      const result = await $`bun ${cliPath} ${testFile} --search JSON --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(0);
    });

    test('handles non-existent file gracefully', async () => {
      try {
        await $`bun ${cliPath} /nonexistent/file.jsonl`.throws(true);
        expect(false).toBe(true); // Should not reach here
      } catch (error: any) {
        // Bun shell errors have stderr as string
        const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString() || '';
        expect(stderr).toContain('not found');
      }
    });
  });

  describe('info command', () => {
    test('shows transcript info', async () => {
      const result = await $`bun ${cliPath} info ${testFile}`.text();

      expect(result).toContain('Transcript Information');
      expect(result).toContain('Session ID');
      expect(result).toContain('Line Count');
      expect(result).toContain('Message Types');
    });
  });

  // Note: list and search commands require the PROJECTS_DIR to have transcripts
  // These are skipped in unit tests but should be tested with real data
});

// ============================================================================
// TRANSCRIPT-002: New Feature Tests (Acceptance Criteria)
// ============================================================================
// These tests define the expected behavior for new features.
// They will fail until the features are implemented by transcript-dev.

// CLI integration tests skipped - bin/transcript.ts migrated to Rust
describe.skip('TRANSCRIPT-002: New CLI Features', () => {
  const cliPath = join(process.cwd(), 'bin/transcript.ts');

  describe('AC-001: --output flag for file export', () => {
    test('exports to JSON file', async () => {
      const outputFile = join(tempDir, 'output.json');
      await $`bun ${cliPath} ${testFile} --json --output ${outputFile}`;

      const exists = await Bun.file(outputFile).exists();
      expect(exists).toBe(true);

      const content = await Bun.file(outputFile).text();
      expect(content).toContain('"type":"user"');
    });

    test('exports to text file', async () => {
      const outputFile = join(tempDir, 'output.txt');
      await $`bun ${cliPath} ${testFile} --minimal --output ${outputFile}`;

      const exists = await Bun.file(outputFile).exists();
      expect(exists).toBe(true);

      const content = await Bun.file(outputFile).text();
      expect(content).toContain('Hello, can you help me?');
    });

    test('creates parent directories if needed', async () => {
      const outputFile = join(tempDir, 'nested', 'dir', 'output.json');
      await $`bun ${cliPath} ${testFile} --json --output ${outputFile}`;

      const exists = await Bun.file(outputFile).exists();
      expect(exists).toBe(true);
    });
  });

  describe('AC-002: Timestamp-based --from-time/--to-time filtering', () => {
    test('filters by --from-time timestamp', async () => {
      const result = await $`bun ${cliPath} ${timestampFile} --from-time "2024-06-15T12:00:00Z" --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(3); // noon, evening, night

      const first = JSON.parse(lines[0]!);
      expect(first.uuid).toBe('t2');
    });

    test('filters by --to-time timestamp', async () => {
      const result = await $`bun ${cliPath} ${timestampFile} --to-time "2024-06-15T12:00:00Z" --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2); // morning, noon

      const last = JSON.parse(lines[1]!);
      expect(last.uuid).toBe('t2');
    });

    test('filters by --from-time and --to-time timestamp range', async () => {
      const result = await $`bun ${cliPath} ${timestampFile} --from-time "2024-06-15T10:00:00Z" --to-time "2024-06-15T20:00:00Z" --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(2); // noon, evening
    });

    test('supports relative time formats like "1h ago" or "30m ago"', async () => {
      // This test creates a transcript with recent timestamps
      const recentTranscript = join(tempDir, 'recent.jsonl');
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const recentContent = `{"type":"user","uuid":"r1","sessionId":"recent","timestamp":"${twoHoursAgo.toISOString()}","cwd":"/project","message":{"role":"user","content":"Old message"}}
{"type":"user","uuid":"r2","sessionId":"recent","timestamp":"${now.toISOString()}","cwd":"/project","message":{"role":"user","content":"Recent message"}}`;

      await Bun.write(recentTranscript, recentContent);

      const result = await $`bun ${cliPath} ${recentTranscript} --from-time "1h ago" --json`.text();

      const lines = result.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBe(1);

      const recent = JSON.parse(lines[0]!);
      expect(recent.uuid).toBe('r2');
    });
  });

  describe('AC-003: --tail mode for watching', () => {
    test('outputs formatted one-liners in tail mode', async () => {
      // --tail mode runs indefinitely (streaming mode), so we spawn and collect output
      const proc = Bun.spawn(['bun', cliPath, testFile, '--tail', '--last', '3'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Give it time to output initial content
      await new Promise((r) => setTimeout(r, 300));

      // Read what was output
      const reader = proc.stdout.getReader();
      const chunks: Uint8Array[] = [];

      // Read available chunks (non-blocking approach)
      const readPromise = reader.read().then(({ value }) => {
        if (value) chunks.push(value);
      });

      // Wait briefly for the read
      await Promise.race([
        readPromise,
        new Promise((r) => setTimeout(r, 100)),
      ]);

      reader.releaseLock();
      proc.kill();
      await proc.exited;

      const result = new TextDecoder().decode(chunks[0] || new Uint8Array());
      const lines = result.trim().split('\n').filter((l) => l.trim());

      // Should have output (may be less than 3 due to timing)
      expect(lines.length).toBeGreaterThan(0);

      // Should include timestamp format HH:MM
      expect(lines[0]).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe('AC-004: --watch mode for live updates', () => {
    test('accepts --watch flag and starts watching', async () => {
      // Watch mode is difficult to fully test in unit tests since it runs indefinitely.
      // This test verifies the flag is accepted and the process starts without error.
      const proc = Bun.spawn(['bun', cliPath, testFile, '--watch', '--tail'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Give it time to start and output initial content
      await new Promise((r) => setTimeout(r, 300));

      // Process should be running (exitCode is null for running process)
      expect(proc.exitCode).toBe(null);

      // Clean up
      proc.kill();

      // Wait for process to fully terminate
      await proc.exited;
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

// CLI integration tests skipped - bin/transcript.ts migrated to Rust
describe.skip('Edge Cases', () => {
  const cliPath = join(process.cwd(), 'bin/transcript.ts');

  test('handles empty transcript file', async () => {
    const emptyFile = join(tempDir, 'empty.jsonl');
    await Bun.write(emptyFile, '');

    const result = await $`bun ${cliPath} ${emptyFile}`.text();

    expect(result).toContain('No matching lines');
  });

  test('handles transcript with malformed JSON lines', async () => {
    const malformedFile = join(tempDir, 'malformed.jsonl');
    const content = `{"type":"user","uuid":"u1","timestamp":"2024-01-01T10:00:00Z","message":{"role":"user","content":"Valid"}}
not valid json at all
{"type":"assistant","uuid":"a1","timestamp":"2024-01-01T10:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"Also valid"}]}}`;

    await Bun.write(malformedFile, content);

    // Should parse valid lines, skip invalid
    const result = await $`bun ${cliPath} ${malformedFile} --json`.text();

    const lines = result.trim().split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(2);
  });

  test('handles invalid type filter gracefully', async () => {
    try {
      await $`bun ${cliPath} ${testFile} --type invalidtype`.throws(true);
      expect(false).toBe(true);
    } catch (error: any) {
      expect(error.stderr.toString()).toContain('invalid types');
    }
  });

  test('handles multiple type filters', async () => {
    const result = await $`bun ${cliPath} ${testFile} --type user,assistant --json`.text();

    const lines = result.trim().split('\n').filter((l) => l.trim());
    // Should include both user and assistant messages
    expect(lines.length).toBeGreaterThanOrEqual(4);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(['user', 'assistant']).toContain(parsed.type);
    }
  });

  test('combines filters correctly', async () => {
    // Get last 2 assistant messages
    const result = await $`bun ${cliPath} ${testFile} --assistant --last 2 --json`.text();

    const lines = result.trim().split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(2);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.type).toBe('assistant');
    }
  });
});
