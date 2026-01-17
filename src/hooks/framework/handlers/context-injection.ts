/**
 * Context Injection Built-in Handler
 *
 * Injects session context on SessionStart and PreCompact events.
 * Supports customizable templates with variable substitution.
 */

import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';
import type { ContextInjectionOptions } from '../config/types';
import type { SessionStartInput, PreCompactInput } from '../../types';
import { getSessionName } from '../../sessions/store';

// ============================================================================
// Default Template
// ============================================================================

const DEFAULT_TEMPLATE = `<session-context>
Session ID: {{sessionId}}
{{#sessionName}}Session Name: {{sessionName}}{{/sessionName}}
Working Directory: {{cwd}}
{{#source}}Source: {{source}}{{/source}}
{{#variables}}
{{#each variables}}
{{key}}: {{value}}
{{/each}}
{{/variables}}
</session-context>`;

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a context-injection handler with the given options
 */
export function createContextInjectionHandler(
  options: ContextInjectionOptions = {}
): HandlerDefinition {
  const {
    template = DEFAULT_TEMPLATE,
    onSessionStart = true,
    onPreCompact = true,
    variables = {},
  } = options;

  return {
    id: 'context-injection',
    name: 'Context Injection',
    description: 'Injects session context into Claude\'s context',
    priority: 30,
    enabled: true,
    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      const eventType = ctx.eventType;

      // Only handle SessionStart and PreCompact
      if (eventType !== 'SessionStart' && eventType !== 'PreCompact') {
        return { success: true, durationMs: 0 };
      }

      // Check if this event type is enabled
      if (eventType === 'SessionStart' && !onSessionStart) {
        return { success: true, durationMs: 0 };
      }
      if (eventType === 'PreCompact' && !onPreCompact) {
        return { success: true, durationMs: 0 };
      }

      // Build context data
      const contextData = buildContextData(ctx, variables);

      // Render template
      const renderedContext = renderTemplate(template, contextData);

      return {
        success: true,
        durationMs: 0,
        contextToInject: renderedContext,
        data: contextData,
      };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ContextData {
  sessionId: string;
  sessionName?: string;
  cwd: string;
  source?: string;
  trigger?: string;
  variables: Record<string, string>;
  timestamp: string;
  eventType: string;
}

/**
 * Build context data from pipeline context
 */
function buildContextData(
  ctx: PipelineContext,
  customVariables: Record<string, string>
): ContextData {
  const event = ctx.event as SessionStartInput | PreCompactInput;

  // Try to get session name
  let sessionName: string | undefined;
  if (ctx.sessionId) {
    sessionName = getSessionName(ctx.sessionId);
  }

  // Check if session name is in pipeline state (from session-naming handler)
  const stateSessionName = (ctx.state as Record<string, unknown>).sessionName as string | undefined;
  if (stateSessionName) {
    sessionName = stateSessionName;
  }

  const data: ContextData = {
    sessionId: ctx.sessionId || 'unknown',
    sessionName,
    cwd: ctx.cwd,
    variables: customVariables,
    timestamp: new Date().toISOString(),
    eventType: ctx.eventType,
  };

  // Add event-specific data
  if ('source' in event) {
    data.source = event.source;
  }
  if ('trigger' in event) {
    data.trigger = event.trigger;
  }

  return data;
}

/**
 * Simple template renderer with mustache-like syntax
 *
 * Supports:
 * - {{variable}} - Simple substitution
 * - {{#conditional}}content{{/conditional}} - Conditional blocks
 * - {{#each items}}{{key}}: {{value}}{{/each}} - Iteration over variables
 */
function renderTemplate(template: string, data: ContextData): string {
  let result = template;

  // Handle simple variable substitution
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in data) {
      const value = data[key as keyof ContextData];
      if (typeof value === 'string') {
        return value;
      }
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
    return '';
  });

  // Handle conditional blocks: {{#key}}content{{/key}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    const value = data[key as keyof ContextData];
    if (value && (typeof value !== 'object' || Object.keys(value).length > 0)) {
      // Recursively render the content
      return renderTemplate(content, data);
    }
    return '';
  });

  // Handle {{#each variables}} iteration
  result = result.replace(/\{\{#each\s+variables\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, content) => {
    const entries = Object.entries(data.variables);
    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const [key, value] of entries) {
      let line = content;
      line = line.replace(/\{\{key\}\}/g, key);
      line = line.replace(/\{\{value\}\}/g, value);
      lines.push(line);
    }
    return lines.join('');
  });

  // Clean up empty lines and extra whitespace
  result = result
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Preview what context would be injected
 * Useful for testing templates
 */
export function previewContext(
  options: ContextInjectionOptions,
  overrides: Partial<ContextData> = {}
): string {
  const {
    template = DEFAULT_TEMPLATE,
    variables = {},
  } = options;

  const data: ContextData = {
    sessionId: 'example-session-id',
    sessionName: 'brave-elephant',
    cwd: '/Users/example/project',
    source: 'startup',
    variables,
    timestamp: new Date().toISOString(),
    eventType: 'SessionStart',
    ...overrides,
  };

  return renderTemplate(template, data);
}

/**
 * Get the default template
 */
export function getDefaultTemplate(): string {
  return DEFAULT_TEMPLATE;
}

// ============================================================================
// Default Export
// ============================================================================

export default createContextInjectionHandler;
